/**
 * ServiceDesk Pro — SLA core barrel.
 *
 * `business-hours.ts` knows what a working day is; `engine.ts` turns budgets into
 * deadlines and verdicts. Both are pure, so the service layer imports from here and
 * the test suite imports the same functions with a `FixedClock`.
 */

export {
  DEFAULT_BUSINESS_HOURS,
  addBusinessMinutes,
  businessDateKey,
  businessMinutesBetween,
  formatBusinessWindow,
  isWithinBusinessHours,
  minutesPerBusinessDay,
  minutesPerBusinessWeek,
  msUntilBusinessHours,
  nextBusinessStart,
  normalizeBusinessHours,
  recentBusinessDays,
  type BusinessHours,
} from '@/core/sla/business-hours';

export {
  SLA_SEVERITY,
  budgetFor,
  emptyTarget,
  escalate,
  evaluateTarget,
  evaluateTicketSla,
  isTerminalSlaState,
  markTargetMet,
  projectTargetState,
  reopenTicketSla,
  repriceTarget,
  repriceTicketSla,
  startTarget,
  startTicketSla,
  sweepTicketSla,
  worstSlaState,
  type SlaBudget,
  type SlaPolicySnapshot,
  type SlaTargetSnapshot,
  type SlaTargetView,
  type TicketSlaSnapshot,
  type TicketSlaView,
} from '@/core/sla/engine';
