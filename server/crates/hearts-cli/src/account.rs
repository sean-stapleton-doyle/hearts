//! Plain (non-TUI) account commands: register, login, logout, history.

use anyhow::bail;

use crate::api::{Api, ApiError};

pub async fn register(api: &Api, username: &str) -> anyhow::Result<()> {
    let password = rpassword::prompt_password("password: ")?;
    let confirm = rpassword::prompt_password("confirm password: ")?;
    if password != confirm {
        bail!("passwords do not match");
    }
    match api.register(username, &password).await {
        Ok(account) => {
            println!("registered and logged in as {}", account["username"]);
            Ok(())
        }
        Err(ApiError::Server { message, .. }) => bail!("{message}"),
        Err(error) => Err(error.into()),
    }
}

pub async fn login(api: &Api, username: &str) -> anyhow::Result<()> {
    let password = rpassword::prompt_password("password: ")?;
    match api.login(username, &password).await {
        Ok(account) => {
            println!("logged in as {}", account["username"]);
            Ok(())
        }
        Err(ApiError::Server { message, .. }) => bail!("{message}"),
        Err(error) => Err(error.into()),
    }
}

pub async fn logout(api: &Api) -> anyhow::Result<()> {
    api.logout().await?;
    println!("logged out (your session and its seats remain)");
    Ok(())
}

pub async fn games(api: &Api) -> anyhow::Result<()> {
    let history = match api.my_games().await {
        Ok(history) => history,
        Err(ApiError::Server { code, .. }) if code == "login_required" => {
            bail!("history needs an account — `hearts login <username>` first");
        }
        Err(error) => return Err(error.into()),
    };
    let games = history["games"].as_array().cloned().unwrap_or_default();
    if games.is_empty() {
        println!("no games yet");
        return Ok(());
    }
    for game in games {
        let date = game["created_at"].as_str().unwrap_or_default();
        let date = date.get(..10).unwrap_or(date);
        let status = game["status"].as_str().unwrap_or("?");
        let players: Vec<String> = game["players"]
            .as_array()
            .map(|names| {
                names.iter().map(|n| n.as_str().unwrap_or("?").to_string()).collect()
            })
            .unwrap_or_default();
        let outcome = match (&game["result"], game["your_seat"].as_u64()) {
            (serde_json::Value::Object(result), your_seat) => {
                let scores: Vec<i64> = result["scores"]
                    .as_array()
                    .map(|s| s.iter().filter_map(|v| v.as_i64()).collect())
                    .unwrap_or_default();
                let won = your_seat.is_some_and(|seat| {
                    result["winner_seats"]
                        .as_array()
                        .is_some_and(|w| w.iter().any(|v| v.as_u64() == Some(seat)))
                });
                let scores: Vec<String> = scores.iter().map(|s| s.to_string()).collect();
                format!("scores {}{}", scores.join("/"), if won { "  ← you won" } else { "" })
            }
            _ => String::new(),
        };
        println!(
            "{date}  {status:<11}  {:<30}  {outcome}",
            players.join(", "),
        );
    }
    Ok(())
}
