import { lazy } from 'react'
import { Route } from 'react-router-dom'

const TimesheetWeekPage = lazy(() =>
  import('../pages/TimesheetWeekPage').then((m) => ({ default: m.TimesheetWeekPage })),
)
const TimesheetPlanningPage = lazy(() =>
  import('../pages/TimesheetPlanningPage').then((m) => ({ default: m.TimesheetPlanningPage })),
)
const TimesheetPayrollPage = lazy(() =>
  import('../pages/TimesheetPayrollPage').then((m) => ({ default: m.TimesheetPayrollPage })),
)
const TimesheetEmployeesPage = lazy(() =>
  import('../pages/TimesheetEmployeesPage').then((m) => ({ default: m.TimesheetEmployeesPage })),
)
const TimesheetEmployeeCardPage = lazy(() =>
  import('../pages/TimesheetEmployeeCardPage').then((m) => ({ default: m.TimesheetEmployeeCardPage })),
)
const TimesheetCalendarPage = lazy(() =>
  import('../pages/TimesheetCalendarPage').then((m) => ({ default: m.TimesheetCalendarPage })),
)

export const timesheetRoutes = [
  <Route key="timesheet-week" path="/timesheet" element={<TimesheetWeekPage />} />,
  <Route key="timesheet-planning" path="/timesheet/planning" element={<TimesheetPlanningPage />} />,
  <Route key="timesheet-payroll" path="/timesheet/payroll" element={<TimesheetPayrollPage />} />,
  <Route key="timesheet-employees" path="/timesheet/employees" element={<TimesheetEmployeesPage />} />,
  <Route key="timesheet-employee" path="/timesheet/employees/:empId" element={<TimesheetEmployeeCardPage />} />,
  <Route key="timesheet-calendar" path="/timesheet/calendar" element={<TimesheetCalendarPage />} />,
]
