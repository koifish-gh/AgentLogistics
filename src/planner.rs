use crate::{map::Warehouse, model::Position};
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, BinaryHeap, VecDeque};

/// Four-connected, unit-cost A*. The returned path excludes start and includes goal.
/// Equal costs have a stable coordinate tie-break; no random hash iteration is used.
pub fn astar(
    map: &Warehouse,
    start: Position,
    goal: Position,
    avoid: &BTreeSet<Position>,
) -> Option<VecDeque<Position>> {
    if !map.walkable(start) || !map.walkable(goal) || avoid.contains(&goal) {
        return None;
    }
    let mut open = BinaryHeap::new();
    let mut costs = BTreeMap::from([(start, 0)]);
    let mut parents = BTreeMap::new();
    open.push(Reverse((start.distance(goal), 0u32, start)));
    while let Some(Reverse((_, g, current))) = open.pop() {
        if costs.get(&current).copied() != Some(g) {
            continue;
        }
        if current == goal {
            let mut path = VecDeque::new();
            let mut cursor = goal;
            while cursor != start {
                path.push_front(cursor);
                cursor = parents[&cursor];
            }
            return Some(path);
        }
        for next in map.neighbors(current) {
            if avoid.contains(&next) {
                continue;
            }
            let next_cost = g + 1;
            if costs.get(&next).is_none_or(|old| next_cost < *old) {
                costs.insert(next, next_cost);
                parents.insert(next, current);
                open.push(Reverse((next_cost + next.distance(goal), next_cost, next)));
            }
        }
    }
    None
}
