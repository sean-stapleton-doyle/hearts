mod account;
mod api;
mod app;
mod config;
mod events;
mod sse;
mod ui;

use anyhow::bail;
use clap::{Parser, Subcommand};

use crate::api::Api;
use crate::config::Config;

#[derive(Parser)]
#[command(name = "hearts", about = "Terminal client for the hearts game server")]
struct Cli {
    /// Server base URL (persisted; defaults to http://127.0.0.1:8080)
    #[arg(long, global = true)]
    server: Option<String>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Create a game and wait in its lobby
    Create {
        /// Your display name at the table
        #[arg(long)]
        name: String,
    },
    /// Join a game by invite code
    Join {
        /// The 6-character invite code
        code: String,
        #[arg(long)]
        name: String,
    },
    /// Reattach to your most recent game
    Resume,
    /// Create a lite account (username + password, no email)
    Register { username: String },
    /// Log this session into an account
    Login { username: String },
    /// Detach the account from this session
    Logout,
    /// Your game history (needs an account)
    Games,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let mut config = Config::load()?;
    if let Some(server) = cli.server {
        config.server = server;
        config.save()?;
    }
    let api = Api::connect(&mut config).await?;

    match cli.command {
        Command::Create { name } => {
            let view = api.create_game(&name).await?;
            config.last_game = Some(view.id.clone());
            config.save()?;
            println!("created game — invite code: {}", view.invite_code);
            run_tui(api, view).await
        }
        Command::Join { code, name } => {
            let view = api.join_game(&code, &name).await?;
            config.last_game = Some(view.id.clone());
            config.save()?;
            run_tui(api, view).await
        }
        Command::Resume => {
            let Some(game_id) = config.last_game.clone() else {
                bail!("no game to resume — create or join one first");
            };
            let view = api.get_game(&game_id).await?;
            run_tui(api, view).await
        }
        Command::Register { username } => account::register(&api, &username).await,
        Command::Login { username } => account::login(&api, &username).await,
        Command::Logout => account::logout(&api).await,
        Command::Games => account::games(&api).await,
    }
}

async fn run_tui(api: Api, view: api::GameView) -> anyhow::Result<()> {
    if let Some(summary) = app::run(api, view).await? {
        println!("{summary}");
    }
    Ok(())
}
