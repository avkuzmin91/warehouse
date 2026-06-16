import { useParams } from 'react-router-dom'
import { EmployeeCardFeature } from '../features/timesheet/EmployeeCardFeature'

export function TimesheetEmployeeCardPage() {
  const { empId } = useParams<{ empId: string }>()
  if (!empId) return null
  return <EmployeeCardFeature empId={empId} />
}
