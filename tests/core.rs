use agent_logistics::{
    planner::astar,
    tools::{execute, Command, Replay},
    *,
};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

fn p(x: i32, y: i32) -> Position {
    Position::new(x, y)
}
fn world(width: i32, height: i32, robots: Vec<Position>) -> Simulation {
    Simulation::new(
        Warehouse::new(width, height, BTreeSet::new()).unwrap(),
        robots,
        42,
    )
    .unwrap()
}
fn assert_safe(before: &Simulation, after: &Simulation) {
    assert_eq!(
        after
            .robots
            .values()
            .map(|r| r.position)
            .collect::<BTreeSet<_>>()
            .len(),
        after.robots.len()
    );
    for robot in after.robots.values() {
        assert!(after.map.walkable(robot.position));
        assert!(robot.position.distance(before.robots[&robot.id].position) <= 1);
        for other in after.robots.values().filter(|r| r.id != robot.id) {
            assert!(
                !(robot.position == before.robots[&other.id].position
                    && other.position == before.robots[&robot.id].position)
            );
        }
        if let Some(oid) = robot.order_id {
            assert_eq!(after.orders[&oid].robot_id, Some(robot.id));
        }
    }
    for order in after.orders.values() {
        match order.state {
            OrderState::Assigned | OrderState::InTransit => assert_eq!(
                after.robots[&order.robot_id.unwrap()].order_id,
                Some(order.id)
            ),
            _ => assert!(order.robot_id.is_none()),
        }
    }
}

#[test]
fn astar_matches_bfs_across_obstacle_maps() {
    for mask in 0..256 {
        let obstacles = (0..8)
            .filter(|i| mask & (1 << i) != 0)
            .map(|i| p(1 + i % 2, i / 2))
            .collect();
        let map = Warehouse::new(4, 4, obstacles).unwrap();
        let start = p(0, 0);
        let goal = p(3, 3);
        let mut seen = BTreeMap::from([(start, 0usize)]);
        let mut queue = VecDeque::from([start]);
        while let Some(at) = queue.pop_front() {
            let cost = seen[&at];
            for next in map.neighbors(at) {
                if let std::collections::btree_map::Entry::Vacant(entry) = seen.entry(next) {
                    entry.insert(cost + 1);
                    queue.push_back(next);
                }
            }
        }
        assert_eq!(
            astar(&map, start, goal, &BTreeSet::new()).map(|path| path.len()),
            seen.get(&goal).copied()
        );
    }
}

#[test]
fn path_edge_cases() {
    let map = Warehouse::new(3, 3, BTreeSet::new()).unwrap();
    assert_eq!(
        astar(&map, p(0, 0), p(0, 0), &BTreeSet::new())
            .unwrap()
            .len(),
        0
    );
    assert!(astar(&map, p(-1, 0), p(2, 2), &BTreeSet::new()).is_none());
    assert!(astar(&map, p(0, 0), p(2, 2), &BTreeSet::from([p(2, 2)])).is_none());
}

#[test]
fn lifecycle_and_kpis() {
    let mut sim = world(6, 2, vec![p(0, 0)]);
    let oid = sim.add_order(p(1, 0), p(4, 0), 0).unwrap();
    sim.step(4).unwrap();
    assert_eq!(sim.orders[&oid].state, OrderState::Completed);
    assert_eq!(sim.orders[&oid].completed_at, Some(4));
    assert_eq!(sim.kpis().total_distance, 4);
    assert_eq!(sim.kpis().average_completion_ticks, 4.0);
    assert_eq!(sim.kpis().utilization, 1.0);
    assert_eq!(sim.robots[&1].state, RobotState::Idle);
    assert_eq!(sim.heatmap.iter().flatten().sum::<u64>(), 4);
}

#[test]
fn fault_before_pickup_requeues_order() {
    let mut sim = world(8, 3, vec![p(0, 0), p(0, 2)]);
    let oid = sim.add_order(p(3, 0), p(7, 0), 0).unwrap();
    sim.assign(1, oid).unwrap();
    sim.inject_fault(1).unwrap();
    assert_eq!(sim.orders[&oid].state, OrderState::Pending);
    sim.step(30).unwrap();
    assert_eq!(sim.orders[&oid].state, OrderState::Completed);
    assert_eq!(sim.robots[&2].completed_orders, 1);
    assert_eq!(sim.robots[&1].position, p(0, 0));
    sim.repair(1).unwrap();
    assert_eq!(sim.robots[&1].state, RobotState::Idle);
}

#[test]
fn fault_after_pickup_preserves_and_recovers_cargo() {
    let mut sim = world(8, 3, vec![p(0, 0), p(0, 2)]);
    let oid = sim.add_order(p(1, 0), p(7, 0), 0).unwrap();
    sim.assign(1, oid).unwrap();
    sim.step(2).unwrap();
    assert_eq!(sim.orders[&oid].state, OrderState::InTransit);
    let cargo_position = sim.robots[&1].position;
    sim.inject_fault(1).unwrap();
    assert_eq!(sim.orders[&oid].recovery_from, Some(cargo_position));
    sim.step(30).unwrap();
    assert_eq!(sim.orders[&oid].state, OrderState::Completed);
    assert!(sim.orders[&oid].recovery_from.is_none());
    assert_eq!(sim.robots[&2].completed_orders, 1);
    assert_eq!(
        sim.events
            .iter()
            .filter(|e| e.kind == "order_completed")
            .count(),
        1
    );
}

#[test]
fn blocked_route_replans_and_unblock_recovers() {
    let mut sim = world(6, 3, vec![p(0, 1)]);
    let oid = sim.add_order(p(0, 1), p(5, 1), 0).unwrap();
    sim.step(1).unwrap();
    sim.set_blocked(p(2, 1), true).unwrap();
    for _ in 0..15 {
        let before = sim.clone();
        sim.step(1).unwrap();
        assert_safe(&before, &sim);
    }
    assert_eq!(sim.orders[&oid].state, OrderState::Completed);
    assert!(sim.kpis().total_distance > 5);
    assert!(sim.set_blocked(sim.robots[&1].position, true).is_err());
    sim.set_blocked(p(2, 1), false).unwrap();
    assert!(sim.map.walkable(p(2, 1)));
}

#[test]
fn no_route_waits_without_teleporting_then_resumes() {
    let mut sim = world(5, 1, vec![p(0, 0)]);
    let oid = sim.add_order(p(0, 0), p(4, 0), 0).unwrap();
    sim.step(1).unwrap();
    sim.set_blocked(p(2, 0), true).unwrap();
    sim.step(10).unwrap();
    assert_eq!(sim.robots[&1].position, p(1, 0));
    assert!(sim.events.iter().any(|e| e.kind == "robot_waiting"));
    sim.set_blocked(p(2, 0), false).unwrap();
    sim.step(3).unwrap();
    assert_eq!(sim.orders[&oid].state, OrderState::Completed);
}

#[test]
fn crossing_traffic_never_collides_or_swaps() {
    let mut sim = world(7, 5, vec![p(0, 2), p(6, 2), p(3, 0), p(3, 4)]);
    sim.strategy = Strategy::Manual;
    for (rid, start, end) in [
        (1, p(0, 2), p(6, 2)),
        (2, p(6, 2), p(0, 2)),
        (3, p(3, 0), p(3, 4)),
        (4, p(3, 4), p(3, 0)),
    ] {
        let oid = sim.add_order(start, end, 0).unwrap();
        sim.assign(rid, oid).unwrap();
    }
    for _ in 0..100 {
        let before = sim.clone();
        sim.step(1).unwrap();
        assert_safe(&before, &sim);
    }
    assert_eq!(sim.kpis().completed_orders, 4);
}

#[test]
fn head_on_corridor_is_safe_and_reports_wait() {
    let mut sim = world(5, 1, vec![p(0, 0), p(4, 0)]);
    sim.strategy = Strategy::Manual;
    for (rid, from, to) in [(1, p(0, 0), p(3, 0)), (2, p(4, 0), p(1, 0))] {
        let oid = sim.add_order(from, to, 0).unwrap();
        sim.assign(rid, oid).unwrap();
    }
    for _ in 0..20 {
        let before = sim.clone();
        sim.step(1).unwrap();
        assert_safe(&before, &sim);
    }
    assert!(sim.events.iter().any(|e| e.kind == "robot_waiting"));
}

#[test]
fn priority_and_manual_control() {
    let mut sim = world(8, 2, vec![p(0, 0)]);
    let low = sim.add_order(p(1, 0), p(6, 0), 0).unwrap();
    let high = sim.add_order(p(2, 0), p(7, 0), 9).unwrap();
    sim.strategy = Strategy::Manual;
    sim.step(1).unwrap();
    assert!(sim.robots[&1].order_id.is_none());
    sim.strategy = Strategy::Nearest;
    assert_eq!(sim.dispatch(), 1);
    assert_eq!(sim.robots[&1].order_id, Some(high));
    assert_eq!(sim.orders[&low].state, OrderState::Pending);
}

#[test]
fn invalid_commands_do_not_mutate_world() {
    let mut sim = world(5, 3, vec![p(0, 0)]);
    for command in [
        Command::AssignOrder {
            robot_id: 9,
            order_id: 1,
        },
        Command::Step { ticks: 0 },
        Command::InjectFault { robot_id: 9 },
        Command::RepairRobot { robot_id: 1 },
        Command::SetBlocked {
            position: p(0, 0),
            blocked: true,
        },
        Command::GenerateOrders { count: 1001 },
        Command::Reset {
            map: Warehouse::demo(),
            robots: vec![p(0, 0), p(0, 0)],
            seed: 1,
        },
    ] {
        let before = serde_json::to_value(&sim).unwrap();
        assert!(execute(&mut sim, &command).is_err());
        assert_eq!(before, serde_json::to_value(&sim).unwrap());
    }
    assert!(serde_json::from_str::<Command>(r#"{"op":"step","ticks":-1}"#).is_err());
    assert!(serde_json::from_str::<Command>(r#"{"op":"step","ticks":1,"typo":2}"#).is_err());
}

#[test]
fn seeded_replay_reproduces_entire_state() {
    let replay = Replay {
        version: 1,
        seed: 0,
        commands: vec![
            Command::GenerateOrders { count: 15 },
            Command::Step { ticks: 8 },
            Command::InjectFault { robot_id: 1 },
            Command::Step { ticks: 15 },
            Command::RepairRobot { robot_id: 1 },
            Command::Step { ticks: 60 },
        ],
    };
    let a = replay.run().unwrap();
    let saved = serde_json::to_string(&replay).unwrap();
    let b = serde_json::from_str::<Replay>(&saved)
        .unwrap()
        .run()
        .unwrap();
    assert_eq!(
        serde_json::to_value(a).unwrap(),
        serde_json::to_value(b).unwrap()
    );
}

#[test]
fn stress_world_invariants_with_faults_and_traffic() {
    for seed in 0..8 {
        let mut sim = Simulation::demo(seed);
        sim.generate_orders(30).unwrap();
        for tick in 0..150 {
            if tick == 10 {
                sim.inject_fault(1).unwrap();
            }
            if tick == 40 {
                sim.repair(1).unwrap();
            }
            let before = sim.clone();
            sim.step(1).unwrap();
            assert_safe(&before, &sim);
        }
    }
}
