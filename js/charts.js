// Small SVG charts. Colours come from CSS variables, so light and dark modes both apply.
// Every chart has one y-axis, a tap/hover readout and a table view with the same values.

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEIGHT = 200;
const MARGIN = { top: 12, right: 12, bottom: 24, left: 44 };
const MAX_BAR = 24;

function svgEl(name, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
}

function niceStep(range, targetTicks) {
  const rough = range / targetTicks;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

function niceScale(min, max, ticks = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const step = niceStep(max - min, ticks);
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step;
  const values = [];
  for (let v = low; v <= high + step / 2; v += step) values.push(Math.round(v * 1000) / 1000);
  return { low, high, values };
}

const tickLabel = (v) => (Math.abs(v) < 10000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }).replace('-', '−') : `${Math.round(v / 1000)}K`);

function frame(scale, width) {
  const plot = { left: MARGIN.left, right: width - MARGIN.right, top: MARGIN.top, bottom: HEIGHT - MARGIN.bottom };
  const y = (v) => plot.bottom - ((v - scale.low) / (scale.high - scale.low)) * (plot.bottom - plot.top);
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, class: 'chart-svg', tabindex: 0, role: 'img' });
  for (const value of scale.values) {
    svg.append(svgEl('line', { x1: plot.left, x2: plot.right, y1: y(value), y2: y(value), class: value === 0 ? 'axis-base' : 'grid' }));
    svg.append(svgEl('text', { x: plot.left - 6, y: y(value) + 4, 'text-anchor': 'end', class: 'tick' }, tickLabel(value)));
  }
  return { svg, plot, y };
}

function xLabels(svg, plot, labels, xAt) {
  const maxLabels = Math.max(2, Math.floor((plot.right - plot.left) / 56));
  const every = Math.max(1, Math.ceil((labels.length - 1) / (maxLabels - 1)));
  labels.forEach((label, i) => {
    if (i % every !== 0) return;
    const x = xAt(i);
    const anchor = i === 0 && labels.length > 1 ? 'start' : 'middle';
    svg.append(svgEl('text', { x, y: HEIGHT - 6, 'text-anchor': anchor, class: 'tick' }, label));
  });
}

function legend(items) {
  const el = document.createElement('div');
  el.className = 'legend';
  for (const item of items) {
    const row = document.createElement('span');
    const key = document.createElement('i');
    key.className = `key key-${item.kind}`;
    key.style.background = item.color;
    row.append(key, document.createTextNode(item.name));
    el.append(row);
  }
  return el;
}

function tableView(headers, rows) {
  const details = document.createElement('details');
  details.className = 'table-view';
  const summary = document.createElement('summary');
  summary.textContent = 'Show as table';
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    head.append(th);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const cell of row) tr.insertCell().textContent = cell;
  }
  details.append(summary, table);
  return details;
}

// Positions one readout over the chart. Text goes in through textContent because food names are user data.
function readout(wrap) {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  wrap.append(tip);
  return {
    show(x, title, rows) {
      tip.replaceChildren();
      const head = document.createElement('div');
      head.className = 'tip-title';
      head.textContent = title;
      tip.append(head);
      for (const row of rows) {
        const line = document.createElement('div');
        line.className = 'tip-row';
        const key = document.createElement('i');
        key.className = 'key key-line';
        key.style.background = row.color;
        const value = document.createElement('strong');
        value.textContent = row.value;
        const name = document.createElement('span');
        name.textContent = row.name;
        line.append(key, value, name);
        tip.append(line);
      }
      tip.hidden = false;
      const width = wrap.clientWidth;
      const tipWidth = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(0, x - tipWidth / 2), width - tipWidth)}px`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

// Tap, drag, hover and arrow keys all select the nearest date.
function bindPointer(svg, width, count, xAt, select, clear) {
  let index = -1;
  const toIndex = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width;
    let best = 0;
    for (let i = 1; i < count; i++) {
      if (Math.abs(xAt(i) - x) < Math.abs(xAt(best) - x)) best = i;
    }
    return best;
  };
  svg.addEventListener('pointermove', (e) => { index = toIndex(e.clientX); select(index); });
  svg.addEventListener('pointerdown', (e) => { index = toIndex(e.clientX); select(index); });
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') clear(); });
  svg.addEventListener('blur', clear);
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    index = Math.min(count - 1, Math.max(0, index + (e.key === 'ArrowRight' ? 1 : -1)));
    select(index);
  });
}

function wrapChart(container) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  container.append(wrap);
  return { wrap, width: Math.max(260, wrap.clientWidth) };
}

function barPath(x, width, yFrom, yTo) {
  const r = Math.min(4, width / 2, Math.abs(yTo - yFrom));
  const dir = yTo < yFrom ? 1 : -1; // bars grow up or down from the baseline; only the data end is rounded
  return `M${x} ${yFrom}V${yTo + dir * r}Q${x} ${yTo} ${x + r} ${yTo}H${x + width - r}Q${x + width} ${yTo} ${x + width} ${yTo + dir * r}V${yFrom}Z`;
}

// Deficit and surplus are opposite directions, so they take the diverging blue/red pair.
export function balanceChart(container, { points, target, labelOf, titleOf, valueOf }) {
  const { wrap, width } = wrapChart(container);
  const values = points.filter((p) => p.value !== null).map((p) => p.value);
  const extent = [...values, 0];
  if (target !== null && target !== undefined) extent.push(target);
  const scale = niceScale(Math.min(...extent), Math.max(...extent));
  const { svg, plot, y } = frame(scale, width);
  svg.setAttribute('aria-label', 'Daily calorie balance. Values are available in the table below the chart.');

  const band = (plot.right - plot.left) / points.length;
  const barWidth = Math.max(2, Math.min(MAX_BAR, band - 2));
  const xAt = (i) => plot.left + band * i + band / 2;
  const bars = [];
  points.forEach((p, i) => {
    if (p.value === null || p.value === 0) {
      bars.push(null);
      return;
    }
    const bar = svgEl('path', {
      d: barPath(xAt(i) - barWidth / 2, barWidth, y(0), y(p.value)),
      fill: p.value < 0 ? 'var(--deficit)' : 'var(--surplus)',
    });
    svg.append(bar);
    bars.push(bar);
  });
  if (target !== null && target !== undefined) {
    svg.append(svgEl('line', { x1: plot.left, x2: plot.right, y1: y(target), y2: y(target), class: 'target-line' }));
    svg.append(svgEl('text', { x: plot.right, y: y(target) - 4, 'text-anchor': 'end', class: 'tick tick-halo' }, 'target'));
  }
  xLabels(svg, plot, points.map(labelOf), xAt);
  wrap.append(svg);

  const tip = readout(wrap);
  const clear = () => {
    tip.hide();
    bars.forEach((b) => b?.classList.remove('dim'));
  };
  bindPointer(svg, width, points.length, xAt, (i) => {
    const p = points[i];
    bars.forEach((b, j) => b?.classList.toggle('dim', j !== i));
    tip.show((xAt(i) / width) * wrap.clientWidth, titleOf(p), p.value === null
      ? [{ name: 'not logged', value: '-', color: 'var(--muted)' }]
      : [{ name: p.value < 0 ? 'deficit' : 'surplus', value: valueOf(p.value), color: p.value < 0 ? 'var(--deficit)' : 'var(--surplus)' }]);
  }, clear);

  container.append(legend([
    { name: 'Deficit', color: 'var(--deficit)', kind: 'rect' },
    { name: 'Surplus', color: 'var(--surplus)', kind: 'rect' },
  ]));
  container.append(tableView(['Date', 'Balance'], points.map((p) => [titleOf(p), p.value === null ? 'not logged' : valueOf(p.value)])));
}

function segments(values) {
  const out = [];
  let current = [];
  values.forEach((value, i) => {
    if (value === null) {
      if (current.length) out.push(current);
      current = [];
    } else {
      current.push([i, value]);
    }
  });
  if (current.length) out.push(current);
  return out;
}

// series: [{ name, color, values, connect }]. Null values leave a gap unless `connect` is set.
export function lineChart(container, { dates, series, labelOf, titleOf, valueOf, ariaLabel, ticks = 4 }) {
  const { wrap, width } = wrapChart(container);
  const allValues = series.flatMap((s) => s.values).filter((v) => v !== null);
  const scale = niceScale(Math.min(...allValues), Math.max(...allValues), ticks);
  const { svg, plot, y } = frame(scale, width);
  svg.setAttribute('aria-label', `${ariaLabel}. Values are available in the table below the chart.`);
  const xAt = (i) => (dates.length === 1 ? (plot.left + plot.right) / 2 : plot.left + ((plot.right - plot.left) * i) / (dates.length - 1));

  for (const s of series) {
    const present = s.values.map((v, i) => [i, v]).filter(([, v]) => v !== null);
    const parts = s.connect ? (present.length ? [present] : []) : segments(s.values);
    for (const part of parts) {
      if (part.length === 1) {
        svg.append(svgEl('circle', { cx: xAt(part[0][0]), cy: y(part[0][1]), r: 3, fill: s.color }));
      } else {
        const d = part.map(([i, v], n) => `${n ? 'L' : 'M'}${xAt(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
        svg.append(svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      }
    }
    if (present.length > 1) {
      const [i, v] = present[present.length - 1];
      svg.append(svgEl('circle', { cx: xAt(i), cy: y(v), r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
    }
  }
  xLabels(svg, plot, dates.map(labelOf), xAt);

  const crosshair = svgEl('line', { y1: plot.top, y2: plot.bottom, class: 'crosshair', visibility: 'hidden' });
  svg.append(crosshair);
  wrap.append(svg);

  const tip = readout(wrap);
  bindPointer(svg, width, dates.length, xAt, (i) => {
    crosshair.setAttribute('x1', xAt(i));
    crosshair.setAttribute('x2', xAt(i));
    crosshair.setAttribute('visibility', 'visible');
    tip.show((xAt(i) / width) * wrap.clientWidth, titleOf(dates[i]), series.map((s) => ({
      name: s.name,
      color: s.color,
      value: s.values[i] === null ? '-' : valueOf(s.values[i]),
    })));
  }, () => {
    crosshair.setAttribute('visibility', 'hidden');
    tip.hide();
  });

  container.append(legend(series.map((s) => ({ name: s.name, color: s.color, kind: 'line' }))));
  container.append(tableView(['Date', ...series.map((s) => s.name)], dates.map((date, i) => [
    titleOf(date),
    ...series.map((s) => (s.values[i] === null ? '-' : valueOf(s.values[i]))),
  ])));
}

// One whole split into parts, with labels only inside blocks wide enough to hold them.
export function segmentedBar(container, parts) {
  const bar = document.createElement('div');
  bar.className = 'segbar';
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', parts.map((p) => `${p.name} ${Math.round(p.share * 100)}%`).join(', '));
  for (const part of parts) {
    if (part.share === 0) continue;
    const block = document.createElement('div');
    block.className = 'segbar-part';
    block.style.flexGrow = part.share;
    block.style.background = part.color;
    block.style.color = part.ink;
    block.title = `${part.name}: ${part.value}, ${Math.round(part.share * 100)}%`;
    if (part.share >= 0.12) block.textContent = `${Math.round(part.share * 100)}%`;
    bar.append(block);
  }
  container.append(bar);
  container.append(legend(parts.map((p) => ({ name: p.name, color: p.color, kind: 'rect' }))));
  container.append(tableView(['Meal', 'Calories', 'Share'], parts.map((p) => [p.name, p.value, `${Math.round(p.share * 100)}%`])));
}
