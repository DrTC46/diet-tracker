// Suggestion rules: pure functions over day summaries and entries.
// Every rule has a minimum-data threshold and returns null below it.

import {
  KCAL_PER_KG, MEAL_LABELS, addDays, calibrate, fromISO, latestWeight, mealBreakdown, proteinTarget,
  summarizePeriod, topFoods, weekSplit,
} from './calc.js';

const kcal = (n) => `${Math.round(Math.abs(n)).toLocaleString('en-US')} kcal`;
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${kcal(n)}`;
const pct = (n) => `${Math.round(n * 100)}%`;
const kg = (n) => `${n.toFixed(1)} kg`;

export const LOW_INTAKE_KCAL = 1200;
export const MAX_WEEKLY_LOSS_SHARE = 0.01;

function safetyPace({ recent, weight }) {
  const period = summarizePeriod(recent);
  if (period.loggedDays < 5 || !weight || period.avgBalance >= 0) return null;
  const weeklyLossKg = (-period.avgBalance * 7) / KCAL_PER_KG;
  if (weeklyLossKg / weight <= MAX_WEEKLY_LOSS_SHARE) return null;
  return {
    id: 'safety-pace',
    level: 'safety',
    title: 'Your estimated weight loss is very fast',
    detail: 'Losing faster than about 1% of body weight per week makes muscle loss and fatigue more likely. Consider easing the deficit, and speak to a doctor or dietitian if you want to keep this pace.',
    evidence: [`About ${kg(weeklyLossKg)} per week at ${kg(weight)} body weight`, `Average balance ${signed(period.avgBalance)} per day over ${period.loggedDays} logged days`],
    impact: 10000,
  };
}

function safetyIntake({ recent }) {
  const period = summarizePeriod(recent);
  if (period.loggedDays < 5 || period.avgConsumed >= LOW_INTAKE_KCAL) return null;
  return {
    id: 'safety-intake',
    level: 'safety',
    title: 'Your logged intake is very low',
    detail: `An average under ${kcal(LOW_INTAKE_KCAL)} a day is hard to sustain and can fall short on nutrients. If this is accurate, consider eating more and speaking to a doctor or dietitian. If some food went unlogged, your deficit is smaller than shown.`,
    evidence: [`Average ${kcal(period.avgConsumed)} per day over ${period.loggedDays} logged days`],
    impact: 9000,
  };
}

function loggingGaps({ recent }) {
  const logged = recent.filter((d) => d.counted).length;
  const missing = recent.length - logged;
  if (logged === 0 || recent.length < 7 || logged / recent.length >= 0.7) return null;
  return {
    id: 'logging-gaps',
    level: 'tip',
    title: 'Missing days make these numbers less reliable',
    detail: 'A day counts only when it has both burned calories and food. Filling in the gaps gives you more accurate totals and advice.',
    evidence: [`${logged} of the last ${recent.length} days are complete`, `${missing} days are left out of the estimates`],
    impact: missing * 40,
  };
}

function proteinLow({ week, target }) {
  if (!target) return null;
  const known = week.filter((d) => d.counted && d.proteinComplete);
  if (known.length < 4) return null;
  const under = known.filter((d) => d.protein < target);
  if (under.length < Math.ceil(known.length / 2)) return null;
  const avgGap = under.reduce((s, d) => s + (target - d.protein), 0) / under.length;
  if (avgGap < 10) return null;
  return {
    id: 'protein-low',
    level: 'warn',
    title: 'Protein is regularly under your target',
    detail: `Protein helps keep muscle during a deficit. Adding about ${Math.round(avgGap)} g on those days closes the gap: for example lean meat, fish, eggs, skyr or legumes.`,
    evidence: [`Under ${target} g on ${under.length} of the last ${known.length} days with protein logged`, `Average shortfall ${Math.round(avgGap)} g`],
    impact: avgGap * 5,
  };
}

function weekendSurplus({ month }) {
  const { weekday, weekend } = weekSplit(month);
  if (weekend.days < 2 || weekday.days < 5) return null;
  if (weekend.totalBalance <= 0 || weekday.totalBalance >= 0) return null;
  const share = weekend.totalBalance / -weekday.totalBalance;
  if (share < 0.2) return null;
  return {
    id: 'weekend-surplus',
    level: 'warn',
    title: `Weekends cancel ${pct(share)} of your weekday deficit`,
    detail: 'Your weekdays are working, but the weekend surplus takes back a large part of them. Planning one or two weekend meals in advance is usually easier than cutting further during the week.',
    evidence: [`Weekdays average ${signed(weekday.avgBalance)} per day (${weekday.days} days)`, `Weekends average ${signed(weekend.avgBalance)} per day (${weekend.days} days)`],
    impact: weekend.avgBalance * (2 / 7) + 100,
  };
}

function mealShare({ fortnight, entries }) {
  if (fortnight.filter((d) => d.counted).length < 5) return null;
  const meals = mealBreakdown(fortnight, entries);
  const top = meals.reduce((a, b) => (b.share > a.share ? b : a));
  if (top.share < 0.45) return null;
  return {
    id: 'meal-share',
    level: 'tip',
    title: `${MEAL_LABELS[top.meal]} is ${pct(top.share)} of your calories`,
    detail: 'One very large meal can mean long hungry stretches beforehand. Moving some of those calories to another meal may make your target easier to hold.',
    evidence: meals.map((m) => `${MEAL_LABELS[m.meal]}: ${pct(m.share)}`),
    impact: (top.share - 0.35) * 500,
  };
}

function foodsToReview({ month, entries }) {
  if (month.filter((d) => d.counted).length < 7) return null;
  const foods = topFoods(month, entries, 20);
  // A repeat item with little protein for its calories is the easiest swap.
  // Under 2.5 g per 100 kcal means under 10% of its calories come from protein.
  const swap = foods.find((f) => f.count >= 3 && f.share >= 0.05 && f.proteinKnown && (f.proteinG / f.kcal) * 100 < 2.5);
  const top = foods[0];
  const pick = swap ?? (top && top.share >= 0.15 && top.count >= 3 ? top : null);
  if (!pick) return null;
  return {
    id: 'food-review',
    level: 'tip',
    title: swap ? `"${pick.name}" is worth a second look` : `"${pick.name}" is your largest calorie source`,
    detail: swap
      ? 'It adds a lot of calories for very little protein. A smaller portion or a higher-protein swap would help both numbers.'
      : 'Small portion changes on your most frequent food add up faster than anything else.',
    evidence: [`${pct(pick.share)} of your calories (${kcal(pick.kcal)}, ${pick.count} times in the last ${month.length} days)`],
    impact: (pick.kcal / month.length) * 0.5,
  };
}

function deficitBehind({ fortnight, settings }) {
  const target = settings.targetBalanceKcal;
  if (target === null || target === undefined) return null;
  const period = summarizePeriod(fortnight);
  if (period.loggedDays < 5) return null;
  const gap = period.avgBalance - target;
  const behind = target > 0 ? gap < -100 : gap > 100;
  if (!behind) return null;
  return {
    id: 'target-behind',
    level: 'warn',
    title: `You're ${kcal(gap)} a day away from your target`,
    detail: `Your target balance is ${signed(target)} a day. Over a week, the gap is worth about ${kg((Math.abs(gap) * 7) / KCAL_PER_KG)} of body weight.`,
    evidence: [`Average balance ${signed(period.avgBalance)} per day over ${period.loggedDays} logged days`],
    impact: Math.abs(gap),
  };
}

function goalPace({ fortnight, settings, weight, today }) {
  const goal = settings.goalWeightKg;
  if (!goal || !weight) return null;
  const period = summarizePeriod(fortnight);
  if (period.loggedDays < 5) return null;
  const toGo = goal - weight;
  if (Math.abs(toGo) < 0.1) {
    return { id: 'goal-pace', level: 'good', title: 'You have reached your goal weight', detail: 'Time to set a new goal or a maintenance target.', evidence: [`Latest weight ${kg(weight)}`], impact: 1 };
  }
  const perDay = period.avgBalance / KCAL_PER_KG;
  if (perDay === 0 || Math.sign(perDay) !== Math.sign(toGo)) {
    return {
      id: 'goal-pace',
      level: 'warn',
      title: 'Your current pace moves away from your goal',
      detail: `Your goal is ${kg(goal)}, but your recent balance points the other way.`,
      evidence: [`Latest weight ${kg(weight)}`, `Average balance ${signed(period.avgBalance)} per day`],
      impact: Math.abs(period.avgBalance),
    };
  }
  const daysLeft = Math.ceil(toGo / perDay);
  return {
    id: 'goal-pace',
    level: 'good',
    title: `At this pace you reach ${kg(goal)} around ${fromISO(addDays(today, daysLeft)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    detail: 'This assumes your recent average holds and your logging is accurate. Real progress is rarely a straight line.',
    evidence: [`${kg(Math.abs(toGo))} to go, about ${daysLeft} days`, `Average balance ${signed(period.avgBalance)} per day`],
    impact: 2,
  };
}

function calibrationGap({ days }) {
  const result = calibrate(days);
  if (!result || Math.abs(result.errorKcalPerDay) < 150) return null;
  const over = result.errorKcalPerDay > 0;
  return {
    id: 'calibration',
    level: 'warn',
    title: over ? 'Your real balance looks higher than logged' : 'Your real balance looks lower than logged',
    detail: over
      ? 'Your scale shows less loss (or more gain) than the calories predict. Garmin may overestimate your burn, or some food may be going unlogged. Treat your true deficit as smaller than shown.'
      : 'Your scale shows more loss (or less gain) than the calories predict. Garmin may underestimate your burn, or portions may be logged too high.',
    evidence: [
      `Measured ${result.measuredKg.toFixed(1)} kg vs estimated ${result.estimatedKg.toFixed(1)} kg over ${Math.round(result.spanDays)} days`,
      `Implied gap about ${kcal(result.errorKcalPerDay)} per day`,
    ],
    impact: Math.abs(result.errorKcalPerDay) + 50,
  };
}

const RULES = [safetyPace, safetyIntake, calibrationGap, deficitBehind, weekendSurplus, proteinLow, foodsToReview, mealShare, loggingGaps, goalPace];

// `days` are day summaries in date order, ending today. Today is left out until it counts,
// because its burned total is still rising.
export function buildSuggestions({ days, entries, settings, today }) {
  const settled = days.filter((d) => d.date < today || d.counted);
  const context = {
    days: settled,
    entries,
    settings,
    today,
    week: settled.slice(-7),
    fortnight: settled.slice(-14),
    recent: settled.slice(-14),
    month: settled.slice(-28),
    weight: latestWeight(days) ?? settings.startWeightKg ?? null,
  };
  context.target = proteinTarget(settings, context.weight);
  const order = (s) => (s.level === 'safety' ? 0 : s.level === 'good' ? 2 : 1);
  return RULES.map((rule) => rule(context))
    .filter(Boolean)
    .sort((a, b) => order(a) - order(b) || b.impact - a.impact);
}
