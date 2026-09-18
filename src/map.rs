use crate::model::Position;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Warehouse {
    pub width: i32,
    pub height: i32,
    pub obstacles: BTreeSet<Position>,
    #[serde(default)]
    pub blocked: BTreeSet<Position>,
}
impl Warehouse {
    pub fn new(width: i32, height: i32, obstacles: BTreeSet<Position>) -> Result<Self, String> {
        let map = Self {
            width,
            height,
            obstacles,
            blocked: BTreeSet::new(),
        };
        map.validate()?;
        Ok(map)
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.width <= 0 || self.height <= 0 || self.width > 256 || self.height > 256 {
            return Err("map dimensions must be in 1..=256".into());
        }
        if self
            .obstacles
            .iter()
            .chain(self.blocked.iter())
            .any(|p| !self.contains(*p))
        {
            return Err("obstacle outside map".into());
        }
        Ok(())
    }
    pub fn contains(&self, p: Position) -> bool {
        p.x >= 0 && p.y >= 0 && p.x < self.width && p.y < self.height
    }
    pub fn walkable(&self, p: Position) -> bool {
        self.contains(p) && !self.obstacles.contains(&p) && !self.blocked.contains(&p)
    }
    pub fn neighbors(&self, p: Position) -> impl Iterator<Item = Position> + '_ {
        [
            Position::new(p.x, p.y - 1),
            Position::new(p.x - 1, p.y),
            Position::new(p.x + 1, p.y),
            Position::new(p.x, p.y + 1),
        ]
        .into_iter()
        .filter(|p| self.walkable(*p))
    }
    pub fn demo() -> Self {
        let obstacles = [3, 6, 9]
            .into_iter()
            .flat_map(|x| (2..6).map(move |y| Position::new(x, y)))
            .collect();
        Self::new(12, 8, obstacles).unwrap()
    }
}
