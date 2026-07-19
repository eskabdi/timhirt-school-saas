// ============================================================================
// Route tree (§19.2) — ~50 routes across Admin, Teacher, Student, Parent,
// Public, and Platform surfaces. RequireRole is UX-only; RLS is authoritative
// (§6.2). Public routes (/apply, /verify) carry no session and hit anon-safe
// endpoints only (Edge Function submit / SECURITY DEFINER RPC).
// ============================================================================
import { createBrowserRouter, Navigate } from "react-router-dom";

import { RequireAuth } from "@/features/auth/RequireAuth";
import { RequireRole } from "@/features/auth/RequireRole";
import { RequireModule } from "@/features/auth/RequireModule";
import { LoginPage } from "@/features/auth/LoginPage";
import { AcceptInvitePage } from "@/features/auth/AcceptInvitePage";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { PlatformShell } from "@/components/layout/PlatformShell";

import { DashboardPage } from "@/features/dashboard/DashboardPage";

import { StudentsListPage } from "@/features/students/StudentsListPage";
import { StudentFormPage } from "@/features/students/StudentFormPage";
import { StudentDetailPage } from "@/features/students/StudentDetailPage";

import { AttendanceMarkingPage } from "@/features/attendance/AttendanceMarkingPage";
import { AttendanceOverviewPage } from "@/features/attendance/AttendanceOverviewPage";

import { TimetableEditorPage } from "@/features/timetable/TimetableEditorPage";
import { GradebookPage } from "@/features/gradebook/GradebookPage";
import { ExamsPage } from "@/features/gradebook/ExamsPage";
import { ReportCardBatchPage } from "@/features/gradebook/ReportCardBatchPage";

import { FeeStructuresPage } from "@/features/fees/FeeStructuresPage";
import { InvoicesPage } from "@/features/fees/InvoicesPage";

import { AnnouncementsPage } from "@/features/communication/AnnouncementsPage";

import { AdmissionsKanbanPage } from "@/features/admissions/AdmissionsKanbanPage";
import { AdmissionDetailPage } from "@/features/admissions/AdmissionDetailPage";

import { AssignmentsTeacherPage } from "@/features/assignments/AssignmentsTeacherPage";
import { AssignmentFormPage } from "@/features/assignments/AssignmentFormPage";

import { HostelPage } from "@/features/hostel/HostelPage";
import { InventoryPage } from "@/features/inventory/InventoryPage";
import { DisciplineIncidentsPage } from "@/features/discipline/DisciplineIncidentsPage";
import { ClinicPage } from "@/features/clinic/ClinicPage";
import { LibraryPage } from "@/features/library/LibraryPage";
import { TransportPage } from "@/features/transport/TransportPage";
import { EventsCalendarPage } from "@/features/events/EventsCalendarPage";
import { ReportsPage } from "@/features/reports/ReportsPage";
import { IDCardBatchPage } from "@/features/id-cards/IDCardBatchPage";

import { EmployeeListPage } from "@/features/hr/EmployeeListPage";
import { EmployeeDetailPage } from "@/features/hr/EmployeeDetailPage";
import { LeaveApprovalsPage } from "@/features/hr/LeaveApprovalsPage";
import { PayrollRunsPage } from "@/features/hr/PayrollRunsPage";
import { PayrollRunDetailPage } from "@/features/hr/PayrollRunDetailPage";
import { MyTimetablePage } from "@/features/hr/MyTimetablePage";
import { MyLeavePage } from "@/features/hr/MyLeavePage";
import { MyPayslipsPage } from "@/features/hr/MyPayslipsPage";

import { StudentPortalPage } from "@/features/portal/StudentPortalPage";
import { StudentTimetablePage } from "@/features/portal/StudentTimetablePage";
import { StudentGradesPage } from "@/features/portal/StudentGradesPage";
import { StudentAttendancePage } from "@/features/portal/StudentAttendancePage";
import { StudentAssignmentsPage } from "@/features/portal/StudentAssignmentsPage";
import { ParentPortalPage } from "@/features/portal/ParentPortalPage";
import { ParentChildPage } from "@/features/portal/ParentChildPage";
import { ParentPaymentPage } from "@/features/portal/ParentPaymentPage";

import { AcademicYearsPage } from "@/features/settings/AcademicYearsPage";
import { PromotionPage } from "@/features/settings/PromotionPage";
import { GradingScalesPage } from "@/features/settings/GradingScalesPage";
import { BrandingPage } from "@/features/settings/BrandingPage";
import { IdCardTemplateDesignerPage } from "@/features/settings/IdCardTemplateDesignerPage";
import { UsersPage } from "@/features/settings/UsersPage";
import { CalendarPreferencesPage } from "@/features/settings/CalendarPreferencesPage";
import { ClassesPage } from "@/features/settings/ClassesPage";
import { SubjectsPage } from "@/features/settings/SubjectsPage";

import { TenantsManagementPage } from "@/features/platform/TenantsManagementPage";
import { TenantDetailPage } from "@/features/platform/TenantDetailPage";
import { ModulesMatrixPage } from "@/features/platform/ModulesMatrixPage";
import { IntegrationsPage } from "@/features/platform/IntegrationsPage";
import { BillingPage } from "@/features/platform/BillingPage";
import { StatutoryConfigPage } from "@/features/platform/StatutoryConfigPage";

import { PublicAdmissionFormPage } from "@/features/public/PublicAdmissionFormPage";
import { AdmissionStatusPage } from "@/features/public/AdmissionStatusPage";
import { IDVerificationPage } from "@/features/public/IDVerificationPage";

const FINANCE = ["school_admin", "accountant"];
const HR = ["school_admin", "hr_officer"];
const HR_FINANCE = ["school_admin", "hr_officer", "accountant"];
const TEACH = ["school_admin", "teacher"];
const ADMIN_REG = ["school_admin", "registrar"];

export const router = createBrowserRouter([
  // ---------- Public (no session) ----------
  { path: "/login", element: <LoginPage /> },
  { path: "/accept-invite", element: <AcceptInvitePage /> },
  { path: "/apply/:tenantSlug", element: <PublicAdmissionFormPage /> },
  { path: "/apply/:tenantSlug/status", element: <AdmissionStatusPage /> },
  { path: "/verify/:code?", element: <IDVerificationPage /> },

  // ---------- Authenticated ----------
  {
    element: <RequireAuth />,
    children: [
      {
        element: <DashboardShell />,
        children: [
          { index: true, element: <DashboardPage /> },

          // Admin: Students (SIS) + Admissions + ID cards — each its own
          // module, so each gets its own RequireModule nested under the
          // shared role check.
          {
            element: <RequireRole roles={ADMIN_REG} />,
            children: [
              {
                element: <RequireModule module="sis" />,
                children: [
                  { path: "students", element: <StudentsListPage /> },
                  { path: "students/new", element: <StudentFormPage /> },
                  { path: "students/:id", element: <StudentDetailPage /> },
                ],
              },
              {
                element: <RequireModule module="admissions" />,
                children: [
                  { path: "admissions", element: <AdmissionsKanbanPage /> },
                  { path: "admissions/:id", element: <AdmissionDetailPage /> },
                ],
              },
              {
                element: <RequireModule module="id_cards" />,
                children: [{ path: "id-cards", element: <IDCardBatchPage /> }],
              },
            ],
          },

          // Admin: Academic setup. classes/subjects/settings/* are core
          // tenant configuration, not one of the 18 subscription modules —
          // left ungated. The rest each map to their own module.
          {
            element: <RequireRole roles={["school_admin"]} />,
            children: [
              { path: "classes", element: <ClassesPage /> },
              { path: "subjects", element: <SubjectsPage /> },
              {
                element: <RequireModule module="fees" />,
                children: [{ path: "fees/structures", element: <FeeStructuresPage /> }],
              },
              {
                element: <RequireModule module="communication" />,
                children: [{ path: "communication", element: <AnnouncementsPage /> }],
              },
              {
                element: <RequireModule module="hostel" />,
                children: [{ path: "hostel", element: <HostelPage /> }],
              },
              {
                element: <RequireModule module="discipline" />,
                children: [{ path: "discipline", element: <DisciplineIncidentsPage /> }],
              },
              {
                element: <RequireModule module="clinic" />,
                children: [{ path: "clinic", element: <ClinicPage /> }],
              },
              {
                element: <RequireModule module="library" />,
                children: [{ path: "library", element: <LibraryPage /> }],
              },
              {
                element: <RequireModule module="transport" />,
                children: [{ path: "transport", element: <TransportPage /> }],
              },
              {
                element: <RequireModule module="events" />,
                children: [{ path: "events", element: <EventsCalendarPage /> }],
              },
              { path: "settings/academic-years", element: <AcademicYearsPage /> },
              { path: "settings/promotion", element: <PromotionPage /> },
              { path: "settings/grading-scales", element: <GradingScalesPage /> },
              { path: "settings/branding", element: <BrandingPage /> },
              { path: "settings/id-card-template", element: <IdCardTemplateDesignerPage /> },
              { path: "settings/users", element: <UsersPage /> },
              { path: "settings/calendar", element: <CalendarPreferencesPage /> },
            ],
          },

          // Admin + Accountant: Fees, Inventory, Reports
          {
            element: <RequireRole roles={FINANCE} />,
            children: [
              {
                element: <RequireModule module="fees" />,
                children: [{ path: "fees/invoices", element: <InvoicesPage /> }],
              },
              {
                element: <RequireModule module="inventory" />,
                children: [{ path: "inventory", element: <InventoryPage /> }],
              },
              {
                element: <RequireModule module="reporting" />,
                children: [{ path: "reports", element: <ReportsPage /> }],
              },
            ],
          },

          // Teacher (+ admin view): Attendance, Timetable view, Gradebook, Assignments
          {
            element: <RequireRole roles={TEACH} />,
            children: [
              {
                element: <RequireModule module="attendance" />,
                children: [
                  { path: "attendance", element: <AttendanceMarkingPage /> },
                  { path: "attendance/overview", element: <AttendanceOverviewPage /> },
                ],
              },
              {
                element: <RequireModule module="timetable" />,
                children: [{ path: "timetable", element: <TimetableEditorPage /> }],
              },
              {
                element: <RequireModule module="gradebook" />,
                children: [
                  { path: "gradebook", element: <GradebookPage /> },
                  { path: "exams", element: <ExamsPage /> },
                  { path: "report-cards", element: <ReportCardBatchPage /> },
                ],
              },
              {
                element: <RequireModule module="assignments" />,
                children: [
                  { path: "assignments", element: <AssignmentsTeacherPage /> },
                  { path: "assignments/new", element: <AssignmentFormPage /> },
                ],
              },
            ],
          },
          {
            element: <RequireModule module="timetable" />,
            children: [{ path: "my/timetable", element: <MyTimetablePage /> }],
          },

          // HR & Payroll
          {
            element: <RequireRole roles={HR} />,
            children: [
              {
                element: <RequireModule module="hr_payroll" />,
                children: [
                  { path: "hr/employees", element: <EmployeeListPage /> },
                  { path: "hr/employees/:id", element: <EmployeeDetailPage /> },
                  { path: "hr/leave", element: <LeaveApprovalsPage /> },
                ],
              },
            ],
          },
          {
            element: <RequireRole roles={HR_FINANCE} />,
            children: [
              {
                element: <RequireModule module="hr_payroll" />,
                children: [
                  { path: "hr/payroll", element: <PayrollRunsPage /> },
                  { path: "hr/payroll/:runId", element: <PayrollRunDetailPage /> },
                ],
              },
            ],
          },
          {
            element: <RequireModule module="hr_payroll" />,
            children: [
              { path: "my/leave", element: <MyLeavePage /> },
              { path: "my/payslips", element: <MyPayslipsPage /> },
            ],
          },

          // Student self-service
          {
            element: <RequireRole roles={["student"]} />,
            children: [
              { path: "portal", element: <StudentPortalPage /> },
              { path: "portal/timetable", element: <StudentTimetablePage /> },
              { path: "portal/grades", element: <StudentGradesPage /> },
              { path: "portal/attendance", element: <StudentAttendancePage /> },
              { path: "portal/assignments", element: <StudentAssignmentsPage /> },
            ],
          },

          // Parent self-service
          {
            element: <RequireRole roles={["parent"]} />,
            children: [
              { path: "portal", element: <ParentPortalPage /> },
              { path: "portal/child/:id", element: <ParentChildPage /> },
              { path: "portal/pay", element: <ParentPaymentPage /> },
            ],
          },
        ],
      },

      // Platform console (super_admin) — separate shell, no tenant sidebar
      {
        path: "/platform",
        element: <RequireRole roles={["super_admin"]} />,
        children: [
          {
            element: <PlatformShell />,
            children: [
              { index: true, element: <Navigate to="tenants" replace /> },
              { path: "tenants", element: <TenantsManagementPage /> },
              { path: "tenants/:id", element: <TenantDetailPage /> },
              { path: "modules", element: <ModulesMatrixPage /> },
              { path: "integrations", element: <IntegrationsPage /> },
              { path: "billing", element: <BillingPage /> },
              { path: "statutory", element: <StatutoryConfigPage /> },
            ],
          },
        ],
      },
    ],
  },

  { path: "*", element: <Navigate to="/" replace /> },
]);
