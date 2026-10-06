function robotsOf(world) {
  return Object.values(world?.robots || {});
}

function ordersOf(world) {
  return Object.values(world?.orders || {});
}

function stepOf(robot) {
  const next = robot.path?.[0];
  if (!next || !robot.position) return null;
  const dx = Math.sign(next.x - robot.position.x);
  const dy = Math.sign(next.y - robot.position.y);
  if (!dx && !dy) return null;
  return { dx, dy, next };
}

export function headOnYielders(robots) {
  const moving = robots.filter((robot) => (
    robot.path?.length
    && (robot.state === 'to_pickup' || robot.state === 'to_dropoff')
  ));
  const chosen = new Map();
  for (const robot of moving) {
    const step = stepOf(robot);
    if (!step) continue;
    const other = moving.find((item) => item.position?.x === step.next.x && item.position?.y === step.next.y);
    if (!other) continue;
    const back = stepOf(other);
    if (!back) continue;
    const mutual = back.next.x === robot.position.x && back.next.y === robot.position.y;
    const opposite = step.dx === -back.dx && step.dy === -back.dy;
    if (!mutual && !opposite) continue;
    const robotYields = robot.path.length > other.path.length
      || (robot.path.length === other.path.length && robot.id > other.id);
    const yielder = robotYields ? robot : other;
    const blocker = robotYields ? other : robot;
    chosen.set(yielder.id, {
      id: yielder.id,
      blockerId: blocker.id,
      avoid: { x: blocker.position.x, y: blocker.position.y },
    });
  }
  return [...chosen.values()];
}

export function classifyTrigger(world, handledFaults = new Set()) {
  const robots = robotsOf(world);
  const orders = ordersOf(world);
  if (!robots.length) return null;

  const faulted = robots.filter((robot) => robot.state === 'faulted' && !handledFaults.has(robot.id));
  if (faulted.length) {
    const held = faulted.map((robot) => robot.order_id).filter(Boolean);
    return {
      type: 'fault',
      title: '机器人故障',
      detail: `R${faulted.map((robot) => robot.id).join('、R')} 发生故障${
        held.length ? `，未完成订单 #${held.join('、#')} 已退回待分配` : ''
      }`,
    };
  }

  const waiting = headOnYielders(robots);
  if (waiting.length) {
    const names = waiting.map((item) => `R${item.id} 给 R${item.blockerId} 让路`).join('，');
    return {
      type: 'congestion',
      title: '通道对向',
      detail: names,
    };
  }

  const pending = orders.filter((order) => order.state === 'pending');
  const idle = robots.filter((robot) => robot.state === 'idle');
  if (idle.length && pending.length) {
    return {
      type: 'dispatch',
      title: '待分配订单',
      detail: `${pending.length} 个订单待分配，${idle.length} 台机器人空闲`,
    };
  }

  return null;
}

export function agentForTrigger(trigger) {
  if (trigger.type === 'fault') {
    return {
      id: 'exception',
      name: '异常 Agent',
      tools: ['assign_order'],
      system: [
        '你是异常 Agent，只处理机器人故障。',
        '不要修复故障机器人，它要保持停机，方便演示看到故障。',
        '故障发生时，它没送完的订单已经退回待分配。',
        '把这些订单 assign_order 给其他空闲机器人，优先 completed_orders 更少的，不要分回刚故障的那台。',
        '不要按距离最近来选。不要调用 step。',
        '调用工具时用一句中文说明为什么选这台。',
      ].join('\n'),
    };
  }
  if (trigger.type === 'congestion') {
    return {
      id: 'router',
      name: '路径 Agent',
      tools: ['replan', 'plan_path'],
      system: [
        '你是路径 Agent，只处理通道拥堵。',
        '对正在等待、或挤在同一条通道上的机器人调用 replan，让其中一部分绕开当前通道。',
        '不要给所有机器人都重规划，只调整受堵的那几台。',
        '不要派单，不要修故障，不要调用 step。',
        '调用工具时用一句中文说明为什么让这台绕开。',
      ].join('\n'),
    };
  }
  return {
    id: 'dispatcher',
    name: '派单 Agent',
    tools: ['assign_order', 'plan_path'],
    system: [
      '你是派单 Agent。不要固定把订单分给距离最近的机器人。',
      '比较空闲机器人的 completed_orders：负载高的少分或不分，负载低的优先。',
      '距离只作参考。每个空闲机器人最多分配一单。',
      '订单突发时把订单分散开，避免压到同一台机器人。',
      '必须调用 assign_order。不要调用 step。',
      '调用工具时用一句中文说明为什么这样分配。',
    ].join('\n'),
  };
}

function robotLine(robot) {
  const at = robot.position ? `(${robot.position.x},${robot.position.y})` : '未知位置';
  return `R${robot.id} 位于${at} 已完成${robot.completed_orders || 0}单 状态${robot.state}`;
}

function orderLine(order) {
  const pickup = order.pickup ? `(${order.pickup.x},${order.pickup.y})` : '未知';
  return `#${order.id} 优先级${order.priority ?? 0} 取货${pickup}`;
}

export function eventBrief(trigger, world) {
  const robots = robotsOf(world);
  const orders = ordersOf(world);
  const pending = orders.filter((order) => order.state === 'pending');
  const idle = robots.filter((robot) => robot.state === 'idle');
  if (trigger.type === 'fault') {
    const faulted = robots.filter((robot) => robot.state === 'faulted');
    return [
      `事件：${trigger.title}。${trigger.detail}`,
      `故障机器人保持停机，不要修复，也不要给它们派单：${faulted.map((robot) => `R${robot.id}`).join('、') || '无'}`,
      `待分配订单：${pending.map(orderLine).join('；') || '无'}`,
      `空闲机器人：${idle.map(robotLine).join('；') || '无'}`,
      '只调用 assign_order。每个空闲机器人最多一单。优先已完成单数更少的。',
    ].join('\n');
  }
  if (trigger.type === 'congestion') {
    const yielders = headOnYielders(robots);
    const lines = yielders.map((item) => {
      const robot = robots.find((entry) => entry.id === item.id);
      const left = robot?.path?.length ?? 0;
      return `R${item.id} 剩余 ${left} 格，应给 R${item.blockerId} 让路。replan 的 avoid 只填正对面这一格 {"x":${item.avoid.x},"y":${item.avoid.y}}`;
    });
    return [
      `事件：${trigger.title}。${trigger.detail}`,
      ...lines,
      '只对上面列出的让路机器人调用 replan，每台一次。不要重规划对面那台，不要派单，不要调用 step。',
    ].join('\n');
  }
  return [
    `事件：${trigger.title}。${trigger.detail}`,
    `待分配订单：${pending.map(orderLine).join('；') || '无'}`,
    `空闲机器人：${idle.map(robotLine).join('；') || '无'}`,
    '必须调用 assign_order。每个空闲机器人最多一单。优先已完成单数更少的；完成单数相同，再选离取货点更近的。不要调用 step。',
  ].join('\n');
}

function modelNote(trigger, trace, source) {
  if (source === 'rule') return '';
  if (source === 'fallback') {
    const errorText = (trace || []).find((item) => item.role === 'error')?.error || '';
    if (errorText.includes('超时')) return '模型请求超时，已按本地规则处理。';
    if (/429|额度|1113|余额/.test(errorText)) return '模型额度不足，已按本地规则处理。';
    return '模型没有给出可用动作，已按本地规则处理。';
  }
  const filled = (trace || []).some((item) => item.via === 'rule' && item.name === 'assign_order');
  if (trigger.type === 'congestion') {
    return filled ? '让路由模型决定，空闲机器人仍按本地规则派单。' : '让路由模型决定。';
  }
  return filled ? '这次分配由模型决定，没分完的按本地规则补上。' : '这次分配由模型决定。';
}

export function explainDecision(trigger, trace, source = 'rule') {
  const tools = (trace || []).filter((item) => item && item.name && item.name !== 'step');
  const note = modelNote(trigger, trace, source);
  const assigns = tools.filter((item) => item.name === 'assign_order');
  const replans = tools.filter((item) => item.name === 'replan');
  const assignText = assigns
    .map((item) => `#${item.arguments.order_id} 交给 R${item.arguments.robot_id}`)
    .join('，');

  if (trigger.type === 'fault') {
    const moved = assignText ? `未完成任务改派为 ${assignText}。` : '未完成订单已退回待分配。';
    return `异常 Agent 因${trigger.title}介入。${trigger.detail}。${moved}故障机器人保持停机，要等手动修复。改派时完成单数更少的优先，完成单数相同则选离取货点更近的空闲机器人。${note}`;
  }
  if (trigger.type === 'congestion') {
    const moved = replans.length
      ? `已让 ${replans.map((item) => `R${item.arguments.robot_id}`).join('、')} 避开正对面的那一格，改走旁边的通道。`
      : '本轮没有形成新的绕行。';
    const also = assignText ? `同时把空闲机器人派了出去：${assignText}。` : '';
    return `路径 Agent 因${trigger.title}介入。${trigger.detail}。${moved}${also}只改剩余路程更长的那一台，对面和同向跟随的机器人继续走原来的路。${note}`;
  }
  const basis = '完成单数更少的优先。完成单数相同，就交给离取货点更近的空闲机器人。每多完成 1 单，按多走 4 格计算。';
  const moved = assignText ? `本轮分配：${assignText}。` : '本轮没有分出新订单。';
  return `派单 Agent 因${trigger.title}介入。${trigger.detail}。${moved}${basis}${note}`;
}
