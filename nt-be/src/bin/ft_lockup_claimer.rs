use std::sync::Arc;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    if std::env::var("RUST_LOG").is_err() {
        unsafe {
            std::env::set_var("RUST_LOG", "info");
        }
    }
    env_logger::init();

    let state = match nt_be::AppState::new().await {
        Ok(state) => Arc::new(state),
        Err(e) => {
            eprintln!("Failed to initialize application state: {}", e);
            std::process::exit(1);
        }
    };
    let dry_run = std::env::args().any(|arg| arg == "--dry-run");
    let refresh_only = std::env::args().any(|arg| arg == "--refresh-only");

    let limit = std::env::args().find_map(|arg| arg.strip_prefix("--limit=")?.parse::<i64>().ok());

    match nt_be::services::refresh_ft_lockup_dao_schedules(&state).await {
        Ok(summary) => {
            log::info!(
                "[ft-lockup-claim] refresh done instances={} rows_upserted={}",
                summary.instances,
                summary.rows_upserted
            );
        }
        Err(e) => {
            eprintln!("Failed to refresh FT lockup schedules: {}", e);
            std::process::exit(1);
        }
    }

    if refresh_only {
        return;
    }

    match nt_be::services::run_due_ft_lockup_claims(&state, limit, dry_run).await {
        Ok(summary) => {
            log::info!(
                "[ft-lockup-claim] cycle done due_rows={} attempted={} succeeded={} failed={} dry_run={}",
                summary.due_rows,
                summary.attempted,
                summary.succeeded,
                summary.failed,
                dry_run
            );
        }
        Err(e) => {
            eprintln!("Failed to run FT lockup claim cycle: {}", e);
            std::process::exit(1);
        }
    }
}
