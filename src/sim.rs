use crate::{map::Warehouse, model::*, planner::astar};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Debug, Clone, Serialize)]
pub struct Simulation {
    pub map: Warehouse,
    pub robots: BTreeMap<u32, Robot>,
    pub orders: BTreeMap<u32, Order>,
    pub tick: u64,
    pub strategy: Strategy,
    pub events: Vec<Event>,
    pub heatmap: Vec<Vec<u64>>,
    seed: u64,
    rng: u64,
    next_order: u32,
}

impl Simulation {
    pub fn new(map: Warehouse, positions: Vec<Position>, seed: u64) -> Result<Self, String> {
        map.validate()?;
        if positions.is_empty() || positions.len() > 64 {
            return Err("robot count must be in 1..=64".into());
        }
        if positions.iter().any(|p| !map.walkable(*p))
            || positions.iter().collect::<BTreeSet<_>>().len() != positions.len()
        {
            return Err("robot positions must be distinct walkable cells".into());
        }
        let heatmap = vec![vec![0; map.width as usize]; map.height as usize];
        let robots = positions
            .into_iter()
            .enumerate()
            .map(|(i, p)| (i as u32 + 1, Robot::new(i as u32 + 1, p)))
            .collect();
        Ok(Self {
            map,
            robots,
            orders: BTreeMap::new(),
            tick: 0,
            strategy: Strategy::Nearest,
            events: Vec::new(),
            heatmap,
            seed,
            rng: seed,
            next_order: 1,
        })
    }
    pub fn demo(seed: u64) -> Self {
        Self::new(
            Warehouse::demo(),
            vec![
                Position::new(0, 0),
                Position::new(0, 3),
                Position::new(0, 7),
            ],
            seed,
        )
        .unwrap()
    }
    fn event(
        &mut self,
        kind: &str,
        robot_id: Option<u32>,
        order_id: Option<u32>,
        detail: impl Into<String>,
    ) {
        self.events.push(Event {
            sequence: self.events.len() as u64 + 1,
            tick: self.tick,
            kind: kind.into(),
            robot_id,
            order_id,
            detail: detail.into(),
        });
    }
    fn random(&mut self) -> u64 {
        // SplitMix64, including seed zero. Explicit wrapping makes debug/release identical.
        self.rng = self.rng.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.rng;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }
    pub fn add_order(
        &mut self,
        pickup: Position,
        dropoff: Position,
        priority: u8,
    ) -> Result<u32, String> {
        if priority > 9 {
            return Err("priority must be in 0..=9".into());
        }
        if self.orders.len() >= 10000 {
            return Err("order limit reached (10000)".into());
        }
        if astar(&self.map, pickup, dropoff, &BTreeSet::new()).is_none() {
            return Err("pickup/dropoff invalid or disconnected".into());
        }
        let id = self.next_order;
        self.next_order += 1;
        self.orders.insert(
            id,
            Order {
                id,
                pickup,
                dropoff,
                priority,
                state: OrderState::Pending,
                robot_id: None,
                created_at: self.tick,
                completed_at: None,
                recovery_from: None,
            },
        );
        self.event("order_created", None, Some(id), "order queued");
        Ok(id)
    }
    pub fn generate_orders(&mut self, count: usize) -> Result<Vec<u32>, String> {
        if count > 1000 || self.orders.len() + count > 10000 {
            return Err("batch limit 1000; total order limit 10000".into());
        }
        // Compute connected components once, rather than running A* for every pair.
        let mut unseen: BTreeSet<_> = (0..self.map.height)
            .flat_map(|y| (0..self.map.width).map(move |x| Position::new(x, y)))
            .filter(|p| self.map.walkable(*p))
            .collect();
        let mut components = Vec::new();
        while let Some(start) = unseen.pop_first() {
            let mut queue = VecDeque::from([start]);
            let mut component = vec![start];
            while let Some(at) = queue.pop_front() {
                for next in self.map.neighbors(at) {
                    if unseen.remove(&next) {
                        queue.push_back(next);
                        component.push(next);
                    }
                }
            }
            if component.len() > 1 {
                component.sort();
                components.push(component);
            }
        }
        if components.is_empty() {
            return Err("need two connected walkable cells".into());
        }
        let cells: Vec<_> = components
            .iter()
            .enumerate()
            .flat_map(|(i, cells)| cells.iter().map(move |p| (*p, i)))
            .collect();
        // Transactional generation: invalid batches leave the RNG and world unchanged.
        let mut draft = self.clone();
        let mut ids = Vec::new();
        for _ in 0..count {
            let (pickup, component) = cells[draft.random() as usize % cells.len()];
            let reachable: Vec<_> = components[component]
                .iter()
                .copied()
                .filter(|p| *p != pickup)
                .collect();
            let dropoff = reachable[draft.random() as usize % reachable.len()];
            let priority = (draft.random() % 3) as u8;
            ids.push(draft.add_order(pickup, dropoff, priority)?);
        }
        *self = draft;
        Ok(ids)
    }
    fn occupied_except(&self, robot_id: u32) -> BTreeSet<Position> {
        self.robots
            .values()
            .filter(|r| r.id != robot_id)
            .map(|r| r.position)
            .collect()
    }
    fn pickup_goals(&self, order: &Order) -> Vec<Position> {
        match order.recovery_from {
            Some(p) => self
                .map
                .neighbors(p)
                .chain(std::iter::once(p).filter(|p| self.map.walkable(*p)))
                .collect(),
            None => vec![order.pickup],
        }
    }
    fn route_to(
        &self,
        robot_id: u32,
        goals: &[Position],
        extra_avoid: &BTreeSet<Position>,
    ) -> Option<VecDeque<Position>> {
        let robot = self.robots.get(&robot_id)?;
        let mut avoid = self.occupied_except(robot_id);
        avoid.extend(extra_avoid);
        goals
            .iter()
            .filter_map(|g| {
                let mut route_avoid = avoid.clone();
                // An active robot may vacate the goal before arrival. Keep the goal
                // plannable; movement reservations still prohibit entering it occupied.
                if !extra_avoid.contains(g)
                    && self.robots.values().any(|r| {
                        r.position == *g
                            && matches!(r.state, RobotState::ToPickup | RobotState::ToDropoff)
                    })
                {
                    route_avoid.remove(g);
                }
                astar(&self.map, robot.position, *g, &route_avoid)
            })
            .min_by(|a, b| a.len().cmp(&b.len()).then_with(|| a.cmp(b)))
    }
    pub fn assign(&mut self, robot_id: u32, order_id: u32) -> Result<(), String> {
        let robot = self.robots.get(&robot_id).ok_or("unknown robot")?;
        let order = self.orders.get(&order_id).ok_or("unknown order")?;
        if robot.state != RobotState::Idle || order.state != OrderState::Pending {
            return Err("requires idle robot and pending order".into());
        }
        let path = self
            .route_to(robot_id, &self.pickup_goals(order), &BTreeSet::new())
            .ok_or("no pickup route currently available")?;
        // Do not accept assignments with a statically unreachable delivery leg.
        let arrival = path.back().copied().unwrap_or(robot.position);
        if astar(&self.map, arrival, order.dropoff, &BTreeSet::new()).is_none() {
            return Err("no delivery route".into());
        }
        let robot = self.robots.get_mut(&robot_id).unwrap();
        robot.state = RobotState::ToPickup;
        robot.order_id = Some(order_id);
        robot.path = path;
        robot.consecutive_waits = 0;
        let order = self.orders.get_mut(&order_id).unwrap();
        order.state = OrderState::Assigned;
        order.robot_id = Some(robot_id);
        self.event(
            "order_assigned",
            Some(robot_id),
            Some(order_id),
            "assignment accepted",
        );
        Ok(())
    }
    pub fn dispatch(&mut self) -> usize {
        if self.strategy == Strategy::Manual {
            return 0;
        }
        let mut pending: Vec<_> = self
            .orders
            .values()
            .filter(|o| o.state == OrderState::Pending)
            .map(|o| o.id)
            .collect();
        pending.sort_by_key(|id| {
            let o = &self.orders[id];
            (std::cmp::Reverse(o.priority), o.created_at, o.id)
        });
        let mut count = 0;
        for oid in pending {
            let goals = self.pickup_goals(&self.orders[&oid]);
            let best = self
                .robots
                .values()
                .filter(|r| r.state == RobotState::Idle)
                .filter_map(|r| {
                    let path = self.route_to(r.id, &goals, &BTreeSet::new())?;
                    let penalty = if self.strategy == Strategy::Balanced {
                        r.completed_orders * 4
                    } else {
                        0
                    };
                    Some((path.len() as u64 + penalty, r.id))
                })
                .min();
            if let Some((_, rid)) = best {
                if self.assign(rid, oid).is_ok() {
                    count += 1;
                }
            }
        }
        count
    }
    pub fn replan(&mut self, robot_id: u32, avoid: &BTreeSet<Position>) -> Result<usize, String> {
        if avoid.iter().any(|p| !self.map.contains(*p)) {
            return Err("avoid cell outside map".into());
        }
        let robot = self.robots.get(&robot_id).ok_or("unknown robot")?;
        let oid = robot.order_id.ok_or("robot has no active order")?;
        let order = &self.orders[&oid];
        let goals = match robot.state {
            RobotState::ToPickup => self.pickup_goals(order),
            RobotState::ToDropoff => vec![order.dropoff],
            _ => return Err("robot cannot move".into()),
        };
        let path = self
            .route_to(robot_id, &goals, avoid)
            .ok_or("no route currently available")?;
        let length = path.len();
        self.robots.get_mut(&robot_id).unwrap().path = path;
        self.event(
            "path_replanned",
            Some(robot_id),
            Some(oid),
            format!("{length} steps"),
        );
        Ok(length)
    }
    pub fn set_blocked(&mut self, position: Position, blocked: bool) -> Result<(), String> {
        if !self.map.contains(position) || self.map.obstacles.contains(&position) {
            return Err("must reference a floor cell".into());
        }
        if blocked && self.robots.values().any(|r| r.position == position) {
            return Err("cannot block an occupied cell".into());
        }
        if blocked {
            self.map.blocked.insert(position);
        } else {
            self.map.blocked.remove(&position);
        }
        for robot in self.robots.values_mut() {
            if blocked && robot.path.contains(&position) {
                robot.path.clear();
            }
        }
        self.event(
            "map_changed",
            None,
            None,
            format!("({}, {}) blocked={blocked}", position.x, position.y),
        );
        Ok(())
    }
    pub fn inject_fault(&mut self, robot_id: u32) -> Result<(), String> {
        let robot = self.robots.get_mut(&robot_id).ok_or("unknown robot")?;
        if robot.state == RobotState::Faulted {
            return Err("robot already faulted".into());
        }
        let oid = robot.order_id.take();
        if let Some(oid) = oid {
            let order = self.orders.get_mut(&oid).unwrap();
            if order.state == OrderState::InTransit {
                order.recovery_from = Some(robot.position);
            }
            order.state = OrderState::Pending;
            order.robot_id = None;
        }
        robot.state = RobotState::Faulted;
        robot.path.clear();
        robot.consecutive_waits = 0;
        self.event(
            "robot_faulted",
            Some(robot_id),
            oid,
            "robot remains an obstacle; unfinished order requeued; cargo location preserved",
        );
        Ok(())
    }
    pub fn repair(&mut self, robot_id: u32) -> Result<(), String> {
        let robot = self.robots.get_mut(&robot_id).ok_or("unknown robot")?;
        if robot.state != RobotState::Faulted {
            return Err("robot is not faulted".into());
        }
        robot.state = RobotState::Idle;
        self.event("robot_repaired", Some(robot_id), None, "robot available");
        Ok(())
    }
    fn service(&mut self, rid: u32) {
        let robot = &self.robots[&rid];
        let Some(oid) = robot.order_id else {
            return;
        };
        let order = &self.orders[&oid];
        if robot.state == RobotState::ToPickup && self.pickup_goals(order).contains(&robot.position)
        {
            let order = self.orders.get_mut(&oid).unwrap();
            order.state = OrderState::InTransit;
            order.recovery_from = None;
            let robot = self.robots.get_mut(&rid).unwrap();
            robot.state = RobotState::ToDropoff;
            robot.path.clear();
            self.event("order_picked_up", Some(rid), Some(oid), "cargo collected");
        }
        if self.robots[&rid].state == RobotState::ToDropoff
            && self.robots[&rid].position == self.orders[&oid].dropoff
        {
            let order = self.orders.get_mut(&oid).unwrap();
            order.state = OrderState::Completed;
            order.completed_at = Some(self.tick);
            order.robot_id = None;
            let robot = self.robots.get_mut(&rid).unwrap();
            robot.state = RobotState::Idle;
            robot.order_id = None;
            robot.path.clear();
            robot.consecutive_waits = 0;
            robot.completed_orders += 1;
            self.event(
                "order_completed",
                Some(rid),
                Some(oid),
                "delivery completed",
            );
        }
    }
    pub fn step(&mut self, ticks: u32) -> Result<(), String> {
        if ticks == 0 || ticks > 10000 {
            return Err("ticks must be in 1..=10000".into());
        }
        for _ in 0..ticks {
            self.tick += 1;
            self.dispatch();
            let ids: Vec<_> = self.robots.keys().copied().collect();
            for &rid in &ids {
                if matches!(
                    self.robots[&rid].state,
                    RobotState::ToPickup | RobotState::ToDropoff
                ) {
                    self.robots.get_mut(&rid).unwrap().busy_ticks += 1;
                }
                self.service(rid);
                if self.robots[&rid].order_id.is_some()
                    && (self.robots[&rid].path.is_empty()
                        || self.robots[&rid].consecutive_waits >= 3)
                {
                    let _ = self.replan(rid, &BTreeSet::new());
                }
            }
            // Conservative synchronous reservation: all starting cells are reserved
            // for this tick, prohibiting vertex collisions, head-on swaps and following.
            let occupied: BTreeSet<_> = self.robots.values().map(|r| r.position).collect();
            let mut reserved = BTreeSet::new();
            let mut order = ids.clone();
            let rotate = (self.tick % order.len() as u64) as usize;
            order.rotate_left(rotate);
            for rid in order {
                let robot = self.robots.get_mut(&rid).unwrap();
                if !matches!(robot.state, RobotState::ToPickup | RobotState::ToDropoff) {
                    continue;
                }
                let next = robot.path.front().copied();
                let can_move = next.is_some_and(|p| {
                    self.map.walkable(p)
                        && robot.position.distance(p) == 1
                        && !occupied.contains(&p)
                        && !reserved.contains(&p)
                });
                if can_move {
                    let next = next.unwrap();
                    reserved.insert(next);
                    robot.position = next;
                    robot.path.pop_front();
                    robot.distance += 1;
                    robot.consecutive_waits = 0;
                } else {
                    robot.wait_ticks += 1;
                    robot.consecutive_waits = robot.consecutive_waits.saturating_add(1);
                    if robot.consecutive_waits == 3 {
                        let oid = robot.order_id;
                        self.event(
                            "robot_waiting",
                            Some(rid),
                            oid,
                            "blocked for 3 ticks; replanning or agent intervention required",
                        );
                    }
                }
            }
            for rid in ids {
                self.service(rid);
            }
            for robot in self.robots.values() {
                self.heatmap[robot.position.y as usize][robot.position.x as usize] += 1;
            }
        }
        Ok(())
    }
    pub fn kpis(&self) -> Kpis {
        let completed: Vec<_> = self
            .orders
            .values()
            .filter(|o| o.state == OrderState::Completed)
            .collect();
        let pending = self
            .orders
            .values()
            .filter(|o| o.state == OrderState::Pending)
            .count();
        let total_latency: u64 = completed
            .iter()
            .map(|o| o.completed_at.unwrap() - o.created_at)
            .sum();
        Kpis {
            tick: self.tick,
            total_orders: self.orders.len(),
            completed_orders: completed.len(),
            pending_orders: pending,
            active_orders: self.orders.len() - pending - completed.len(),
            faulted_robots: self
                .robots
                .values()
                .filter(|r| r.state == RobotState::Faulted)
                .count(),
            throughput_per_100_ticks: if self.tick == 0 {
                0.0
            } else {
                completed.len() as f64 * 100.0 / self.tick as f64
            },
            average_completion_ticks: if completed.is_empty() {
                0.0
            } else {
                total_latency as f64 / completed.len() as f64
            },
            utilization: if self.tick == 0 {
                0.0
            } else {
                self.robots.values().map(|r| r.busy_ticks).sum::<u64>() as f64
                    / (self.tick as f64 * self.robots.len() as f64)
            },
            total_distance: self.robots.values().map(|r| r.distance).sum(),
            total_wait_ticks: self.robots.values().map(|r| r.wait_ticks).sum(),
        }
    }
}
