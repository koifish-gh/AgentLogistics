use agent_logistics::{
    tools::{response, Command, Replay},
    Simulation,
};
use serde_json::json;
use std::{
    env, fs,
    io::{self, BufRead, Write},
    path::{Path, PathBuf},
};

// CLI output files must remain under the current project working directory.
fn local_path(raw: &str, writing: bool) -> Result<PathBuf, String> {
    let root = env::current_dir()
        .map_err(|e| e.to_string())?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let path = Path::new(raw);
    let full = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let checked = if writing && !full.exists() {
        let parent = full
            .parent()
            .ok_or("missing parent directory")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        parent.join(full.file_name().ok_or("missing filename")?)
    } else {
        full.canonicalize().map_err(|e| e.to_string())?
    };
    if !checked.starts_with(root) {
        return Err("file must stay under project working directory".into());
    }
    Ok(checked)
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    let mut seed = 42u64;
    let mut record = None;
    let mut replay_file = None;
    let mut demo = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--seed" | "--record" | "--replay" => {
                let option = &args[i];
                i += 1;
                let value = args.get(i).ok_or("missing option value")?;
                match option.as_str() {
                    "--seed" => {
                        seed = value
                            .parse()
                            .map_err(|_| "seed must be an unsigned integer")?
                    }
                    "--record" => record = Some(local_path(value, true)?),
                    _ => replay_file = Some(local_path(value, false)?),
                }
            }
            "--demo" => demo = true,
            "--help" => {
                println!("logistics [--seed 42] [--record replay.json] | --demo | --replay replay.json\nDefault: persistent UTF-8 JSON Lines stdin/stdout. Run from project directory.");
                return Ok(());
            }
            other => return Err(format!("unknown option: {other}")),
        }
        i += 1;
    }
    if replay_file.is_some() && (demo || record.is_some()) {
        return Err("--replay cannot combine with --demo or --record".into());
    }
    if let Some(file) = replay_file {
        let replay: Replay = serde_json::from_slice(&fs::read(file).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let mut sim = replay.run()?;
        println!("{}", response(&mut sim, &Command::GetState));
        return Ok(());
    }
    let mut sim = Simulation::demo(seed);
    let mut replay = Replay {
        version: 1,
        seed,
        commands: vec![],
    };
    if demo {
        let commands = vec![
            Command::GenerateOrders { count: 20 },
            Command::Step { ticks: 10 },
            Command::InjectFault { robot_id: 1 },
            Command::SetStrategy {
                strategy: agent_logistics::Strategy::Balanced,
            },
            Command::Step { ticks: 20 },
            Command::RepairRobot { robot_id: 1 },
            Command::Step { ticks: 270 },
            Command::GetKpis,
        ];
        for command in commands {
            println!("{}", response(&mut sim, &command));
            replay.commands.push(command);
        }
    } else {
        let stdin = io::stdin();
        let mut stdout = io::stdout().lock();
        for line in stdin.lock().lines() {
            let line = line.map_err(|e| e.to_string())?;
            let line = line.trim().trim_start_matches('\u{feff}');
            if line.is_empty() {
                continue;
            }
            let result = match serde_json::from_str::<Command>(line) {
                Ok(command) => {
                    let result = response(&mut sim, &command);
                    replay.commands.push(command);
                    result
                }
                Err(error) => {
                    json!({ "ok": false, "tick": sim.tick, "error": { "code": "invalid_json", "message": error.to_string() } })
                }
            };
            writeln!(stdout, "{result}").map_err(|e| e.to_string())?;
            stdout.flush().map_err(|e| e.to_string())?;
        }
    }
    if let Some(file) = record {
        fs::write(
            file,
            serde_json::to_vec_pretty(&replay).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
