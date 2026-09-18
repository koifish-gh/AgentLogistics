use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}
impl Position {
    pub fn new(x: i32, y: i32) -> Self {
        Self { x, y }
    }
    pub fn distance(self, other: Self) -> u32 {
        self.x.abs_diff(other.x) + self.y.abs_diff(other.y)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RobotState {
    Idle,
    ToPickup,
    ToDropoff,
    Faulted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Robot {
    pub id: u32,
    pub position: Position,
    pub state: RobotState,
    pub order_id: Option<u32>,
    pub path: VecDeque<Position>,
    pub distance: u64,
    pub busy_ticks: u64,
    pub wait_ticks: u64,
    pub consecutive_waits: u32,
    pub completed_orders: u64,
}
impl Robot {
    pub fn new(id: u32, position: Position) -> Self {
        Self {
            id,
            position,
            state: RobotState::Idle,
            order_id: None,
            path: VecDeque::new(),
            distance: 0,
            busy_ticks: 0,
            wait_ticks: 0,
            consecutive_waits: 0,
            completed_orders: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderState {
    Pending,
    Assigned,
    InTransit,
    Completed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Order {
    pub id: u32,
    pub pickup: Position,
    pub dropoff: Position,
    pub priority: u8,
    pub state: OrderState,
    pub robot_id: Option<u32>,
    pub created_at: u64,
    pub completed_at: Option<u64>,
    // Faulted cargo can be collected from an adjacent cell by a recovery robot.
    pub recovery_from: Option<Position>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Strategy {
    Nearest,
    Balanced,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    pub sequence: u64,
    pub tick: u64,
    pub kind: String,
    pub robot_id: Option<u32>,
    pub order_id: Option<u32>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Kpis {
    pub tick: u64,
    pub total_orders: usize,
    pub completed_orders: usize,
    pub pending_orders: usize,
    pub active_orders: usize,
    pub faulted_robots: usize,
    pub throughput_per_100_ticks: f64,
    pub average_completion_ticks: f64,
    pub utilization: f64,
    pub total_distance: u64,
    pub total_wait_ticks: u64,
}
