use crate::{map::Warehouse, model::*, planner::astar, Simulation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    GetState,
    GetKpis,
    GetEvents {
        #[serde(default)]
        after: u64,
    },
    Reset {
        map: Warehouse,
        robots: Vec<Position>,
        seed: u64,
    },
    AddOrder {
        pickup: Position,
        dropoff: Position,
        #[serde(default)]
        priority: u8,
    },
    GenerateOrders {
        count: usize,
    },
    SetStrategy {
        strategy: Strategy,
    },
    Dispatch,
    AssignOrder {
        robot_id: u32,
        order_id: u32,
    },
    PlanPath {
        start: Position,
        goal: Position,
        #[serde(default)]
        avoid: BTreeSet<Position>,
    },
    Replan {
        robot_id: u32,
        #[serde(default)]
        avoid: BTreeSet<Position>,
    },
    SetBlocked {
        position: Position,
        blocked: bool,
    },
    InjectFault {
        robot_id: u32,
    },
    RepairRobot {
        robot_id: u32,
    },
    Step {
        ticks: u32,
    },
}

pub fn execute(sim: &mut Simulation, command: &Command) -> Result<Value, String> {
    match command {
        Command::GetState => Ok(json!({ "world": sim, "kpis": sim.kpis() })),
        Command::GetKpis => Ok(json!(sim.kpis())),
        Command::GetEvents { after } => Ok(json!(sim
            .events
            .iter()
            .filter(|e| e.sequence > *after)
            .collect::<Vec<_>>())),
        Command::Reset { map, robots, seed } => {
            *sim = Simulation::new(map.clone(), robots.clone(), *seed)?;
            Ok(json!({"reset": true}))
        }
        Command::AddOrder {
            pickup,
            dropoff,
            priority,
        } => Ok(json!({ "order_id": sim.add_order(*pickup, *dropoff, *priority)? })),
        Command::GenerateOrders { count } => {
            Ok(json!({ "order_ids": sim.generate_orders(*count)? }))
        }
        Command::SetStrategy { strategy } => {
            sim.strategy = *strategy;
            Ok(json!({ "strategy": strategy }))
        }
        Command::Dispatch => Ok(json!({ "assigned": sim.dispatch() })),
        Command::AssignOrder { robot_id, order_id } => {
            sim.assign(*robot_id, *order_id)?;
            Ok(json!({ "assigned": true }))
        }
        Command::PlanPath { start, goal, avoid } => {
            if avoid.iter().any(|p| !sim.map.contains(*p)) {
                return Err("avoid cell outside map".into());
            }
            let path = astar(&sim.map, *start, *goal, avoid).ok_or("no path")?;
            Ok(json!({ "distance": path.len(), "path": path }))
        }
        Command::Replan { robot_id, avoid } => {
            Ok(json!({ "distance": sim.replan(*robot_id, avoid)? }))
        }
        Command::SetBlocked { position, blocked } => {
            sim.set_blocked(*position, *blocked)?;
            Ok(json!({ "blocked": blocked }))
        }
        Command::InjectFault { robot_id } => {
            sim.inject_fault(*robot_id)?;
            Ok(json!({ "faulted": true }))
        }
        Command::RepairRobot { robot_id } => {
            sim.repair(*robot_id)?;
            Ok(json!({ "repaired": true }))
        }
        Command::Step { ticks } => {
            sim.step(*ticks)?;
            Ok(json!(sim.kpis()))
        }
    }
}

pub fn response(sim: &mut Simulation, command: &Command) -> Value {
    match execute(sim, command) {
        Ok(data) => json!({ "ok": true, "tick": sim.tick, "data": data }),
        Err(message) => {
            json!({ "ok": false, "tick": sim.tick, "error": { "code": "invalid_operation", "message": message } })
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Replay {
    pub version: u32,
    pub seed: u64,
    pub commands: Vec<Command>,
}
impl Replay {
    pub fn run(&self) -> Result<Simulation, String> {
        if self.version != 1 {
            return Err("unsupported replay version".into());
        }
        let mut sim = Simulation::demo(self.seed);
        // Accepted, typed commands are recorded, including rejected operations.
        // Their deterministic errors do not prevent subsequent commands replaying.
        for command in &self.commands {
            let _ = execute(&mut sim, command);
        }
        Ok(sim)
    }
}
