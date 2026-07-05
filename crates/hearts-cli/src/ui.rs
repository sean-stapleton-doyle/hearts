//! All drawing. Pure functions of the app state — no I/O, no mutation —
//! so layout changes never touch client logic.

use ratatui::Frame;
use ratatui::layout::{Alignment, Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Paragraph, Wrap};

use hearts_core::{Card, Suit};

use crate::api::GameView;
use crate::app::{App, Choice};

const ACCENT: Color = Color::Yellow;

pub fn draw_lobby(frame: &mut Frame, view: &GameView, am_creator: bool, status: &Option<String>) {
    let mut lines = vec![
        Line::default(),
        Line::from(Span::styled("H E A R T S", Style::default().add_modifier(Modifier::BOLD))),
        Line::default(),
        Line::from(vec![
            Span::raw("invite code:  "),
            Span::styled(
                view.invite_code.clone(),
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::default(),
        Line::from(format!("{} at the table:", view.players.len())),
    ];
    for player in &view.players {
        let mut tags = Vec::new();
        if player.is_creator {
            tags.push("creator");
        }
        if player.is_you {
            tags.push("you");
        }
        let tags =
            if tags.is_empty() { String::new() } else { format!("  ({})", tags.join(", ")) };
        lines.push(Line::from(format!("  {}. {}{}", player.seat + 1, player.display_name, tags)));
    }
    lines.push(Line::default());
    lines.push(Line::from(Span::styled(
        if am_creator {
            if view.players.len() >= 2 {
                "[s] start the game · [q] quit"
            } else {
                "waiting for players (need at least 2) · [q] quit"
            }
        } else {
            "waiting for the creator to start · [q] quit"
        },
        Style::default().fg(Color::DarkGray),
    )));
    if let Some(status) = status {
        lines.push(Line::from(Span::styled(
            status.clone(),
            Style::default().fg(Color::Red),
        )));
    }
    let block = Block::bordered().title(" hearts — lobby ");
    frame.render_widget(
        Paragraph::new(lines).alignment(Alignment::Center).block(block),
        frame.area(),
    );
}

pub fn draw_game(frame: &mut Frame, app: &App) {
    // The hand panel needs an extra line while bidding: hand + bid selector.
    let bidding = matches!(app.choices().first(), Some(Choice::Bid(_)));
    let [header, main, hand, status] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Min(6),
        Constraint::Length(if bidding { 4 } else { 3 }),
        Constraint::Length(1),
    ])
    .areas(frame.area());
    let [table, log] =
        Layout::horizontal([Constraint::Percentage(58), Constraint::Percentage(42)]).areas(main);

    draw_header(frame, app, header);
    if app.finished {
        draw_final(frame, app, table);
    } else {
        draw_table(frame, app, table);
    }
    draw_log(frame, app, log);
    draw_hand(frame, app, hand);
    draw_status(frame, app, status);
}

fn draw_header(frame: &mut Frame, app: &App, area: Rect) {
    let mut spans = vec![Span::styled(
        " HEARTS ",
        Style::default().fg(Color::Black).bg(ACCENT).add_modifier(Modifier::BOLD),
    )];
    if let Some(game) = &app.view.game {
        let cards = game
            .round
            .as_ref()
            .map(|round| format!(" · {} card(s)", round.cards_dealt))
            .unwrap_or_default();
        spans.push(Span::raw(format!(
            "  round {}/13{cards} · {} · ♥ trump",
            game.round_index, game.phase
        )));
        if let Some(deadline) = app.deadline {
            let left = deadline.saturating_duration_since(std::time::Instant::now()).as_secs();
            spans.push(Span::styled(
                format!("  ⏱ {}:{:02}", left / 60, left % 60),
                Style::default().fg(if left < 30 { Color::Red } else { Color::DarkGray }),
            ));
        }
    }
    spans.push(Span::styled(
        format!("  ·  invite {}", app.view.invite_code),
        Style::default().fg(Color::DarkGray),
    ));
    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

fn draw_table(frame: &mut Frame, app: &App, area: Rect) {
    let names = app.names();
    let my_seat = app.my_seat();
    let mut lines = Vec::new();
    if let Some(game) = &app.view.game {
        let next_seat = game.next.as_ref().map(|turn| turn.seat);
        let round = game.round.as_ref();
        for (seat, name) in names.iter().enumerate() {
            let mut spans = Vec::new();
            spans.push(Span::styled(
                if Some(seat) == next_seat { " ▶ " } else { "   " },
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ));
            let mut name_style = Style::default();
            if Some(seat) == my_seat {
                name_style = name_style.add_modifier(Modifier::BOLD);
            }
            spans.push(Span::styled(format!("{name:<12}"), name_style));
            let is_dealer = round.map(|r| r.dealer == seat).unwrap_or(false);
            spans.push(Span::styled(
                if is_dealer { "(D) " } else { "    " },
                Style::default().fg(Color::DarkGray),
            ));
            if let Some(round) = round {
                let bid = round.bids[seat]
                    .map(|bid| bid.to_string())
                    .unwrap_or_else(|| "–".to_string());
                spans.push(Span::raw(format!(
                    "bid {bid:>2}  won {:>2}  ",
                    round.tricks_won[seat]
                )));
            }
            spans.push(Span::raw(format!("score {:>4}  ", game.scores[seat])));
            if game.away.get(seat).copied().unwrap_or(false) {
                spans.push(Span::styled("away ", Style::default().fg(Color::DarkGray)));
            }
            // The card this seat has put into the current trick.
            if let Some(play) = round
                .and_then(|r| r.current_trick.as_ref())
                .and_then(|t| t.plays.iter().find(|p| p.seat == seat))
            {
                spans.push(card_span(&play.card, Style::default(), false));
            }
            lines.push(Line::from(spans));
        }
        if let Some(trick) = round.and_then(|r| r.current_trick.as_ref()) {
            lines.push(Line::default());
            lines.push(Line::from(Span::styled(
                format!("trick led by {}", names[trick.leader]),
                Style::default().fg(Color::DarkGray),
            )));
        }
    }
    frame.render_widget(
        Paragraph::new(lines).block(Block::bordered().title(" table ")),
        area,
    );
}

fn draw_final(frame: &mut Frame, app: &App, area: Rect) {
    let names = app.names();
    let mut lines = vec![Line::default()];
    match &app.final_result {
        Some((scores, winners)) => {
            let mut standings: Vec<(usize, i32)> =
                scores.iter().copied().enumerate().collect();
            standings.sort_by_key(|&(_, score)| std::cmp::Reverse(score));
            lines.push(Line::from(Span::styled(
                "FINAL SCORES",
                Style::default().add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::default());
            for (seat, score) in standings {
                let star = if winners.contains(&seat) { "★ " } else { "  " };
                lines.push(Line::from(Span::styled(
                    format!("{star}{:<12} {score:>4}", names[seat]),
                    if winners.contains(&seat) {
                        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD)
                    } else {
                        Style::default()
                    },
                )));
            }
        }
        None => lines.push(Line::from(format!("game {}", app.view.status))),
    }
    frame.render_widget(
        Paragraph::new(lines)
            .alignment(Alignment::Center)
            .block(Block::bordered().title(" game over ")),
        area,
    );
}

fn draw_log(frame: &mut Frame, app: &App, area: Rect) {
    let visible = area.height.saturating_sub(2) as usize;
    let start = app.log.len().saturating_sub(visible);
    let lines: Vec<Line> = app.log[start..].iter().map(|entry| Line::from(entry.clone())).collect();
    frame.render_widget(
        Paragraph::new(lines).wrap(Wrap { trim: true }).block(Block::bordered().title(" events ")),
        area,
    );
}

fn draw_hand(frame: &mut Frame, app: &App, area: Rect) {
    let choices = app.choices();
    let my_turn = !choices.is_empty();
    let bidding = matches!(choices.first(), Some(Choice::Bid(_)));

    let hand = app.sorted_hand();
    let selected_card = match app.selected_choice() {
        Some(Choice::Card(card)) => Some(card),
        _ => None,
    };
    let legal: Vec<Card> = choices
        .iter()
        .filter_map(|choice| match choice {
            Choice::Card(card) => Some(*card),
            Choice::Bid(_) => None,
        })
        .collect();
    let mut hand_spans = Vec::new();
    for card in &hand {
        let is_legal = bidding || !my_turn || legal.contains(card);
        let is_selected = selected_card.as_ref() == Some(card);
        let mut style = card_style(card, !is_legal);
        if is_selected {
            style = style.add_modifier(Modifier::REVERSED | Modifier::BOLD);
        }
        hand_spans.push(Span::styled(format!(" {card} "), style));
        hand_spans.push(Span::raw(" "));
    }

    let (title, lines) = if bidding {
        let bid_spans: Vec<Span> = choices
            .iter()
            .enumerate()
            .flat_map(|(i, choice)| {
                let Choice::Bid(bid) = choice else { unreachable!() };
                let style = if i == app.selected.min(choices.len() - 1) {
                    Style::default().add_modifier(Modifier::REVERSED | Modifier::BOLD)
                } else {
                    Style::default()
                };
                [Span::styled(format!(" {bid} "), style), Span::raw(" ")]
            })
            .collect();
        (
            " your bid — ←/→ or digit, enter to confirm ",
            vec![Line::from(hand_spans), Line::from(bid_spans)],
        )
    } else {
        let title = if my_turn {
            " your play — ←/→ + enter "
        } else {
            " your hand "
        };
        (title, vec![Line::from(hand_spans)])
    };
    frame.render_widget(
        Paragraph::new(lines).block(Block::bordered().title(title)),
        area,
    );
}

fn draw_status(frame: &mut Frame, app: &App, area: Rect) {
    let line = if let Some(error) = &app.error {
        Line::from(Span::styled(format!(" ✗ {error}"), Style::default().fg(Color::Red)))
    } else if app.finished {
        Line::from(Span::styled(" game over — [q] quit", Style::default().fg(Color::DarkGray)))
    } else if !app.choices().is_empty() {
        Line::from(Span::styled(
            " your turn!  ←/→ select · enter confirm · q quit",
            Style::default().fg(ACCENT),
        ))
    } else {
        let waiting = app
            .view
            .game
            .as_ref()
            .and_then(|game| game.next.as_ref())
            .map(|turn| {
                format!(" waiting for {} to {}… · q quit", app.names()[turn.seat], turn.action)
            })
            .unwrap_or_else(|| " q quit".to_string());
        Line::from(Span::styled(waiting, Style::default().fg(Color::DarkGray)))
    };
    frame.render_widget(Paragraph::new(line), area);
}

fn card_span(card: &Card, base: Style, dimmed: bool) -> Span<'static> {
    Span::styled(format!("{card}"), card_style_from(base, card, dimmed))
}

fn card_style(card: &Card, dimmed: bool) -> Style {
    card_style_from(Style::default(), card, dimmed)
}

fn card_style_from(base: Style, card: &Card, dimmed: bool) -> Style {
    if dimmed {
        base.fg(Color::DarkGray)
    } else if matches!(card.suit, Suit::Hearts | Suit::Diamonds) {
        base.fg(Color::Red)
    } else {
        base.fg(Color::White)
    }
}

/// Sorted-hand helper reused by tests.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::display_key;
    use hearts_core::Rank;

    #[test]
    fn display_order_groups_suits_hearts_last() {
        let mut cards = vec![
            Card::new(Suit::Hearts, Rank::Two),
            Card::new(Suit::Clubs, Rank::Ace),
            Card::new(Suit::Spades, Rank::Three),
            Card::new(Suit::Clubs, Rank::Two),
        ];
        cards.sort_by_key(display_key);
        assert_eq!(
            cards,
            vec![
                Card::new(Suit::Clubs, Rank::Two),
                Card::new(Suit::Clubs, Rank::Ace),
                Card::new(Suit::Spades, Rank::Three),
                Card::new(Suit::Hearts, Rank::Two),
            ]
        );
    }
}
