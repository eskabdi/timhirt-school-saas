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
import { SsoCallbackPage } from "@/features/auth/SsoCallbackPage";
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
import { InvoiceDetailPage } from "@/features/fees/InvoiceDetailPage";

import { AnnouncementsPage } from "@/features/communication/AnnouncementsPage";
import { NoticesPage } from "@/features/communication/NoticesPage";
import { MessagesPage } from "@/features/communication/MessagesPage";

import { AdmissionsListPage } from "@/features/admissions/AdmissionsListPage";
import { AdmissionDetailPage } from "@/features/admissions/AdmissionDetailPage";

import { AssignmentsTeacherPage } from "@/features/assignments/AssignmentsTeacherPage";
import { AssignmentFormPage } from "@/features/assignments/AssignmentFormPage";

import { HostelPage } from "@/features/hostel/HostelPage";
import { InventoryPage } from "@/features/inventory/InventoryPage";
import { DisciplineIncidentsPage } from "@/features/discipline/DisciplineIncidentsPage";
import { ClinicPage } from "@/features/clinic/ClinicPage";
import { LibraryCatalogPage } from "@/features/library/LibraryCatalogPage";
import { LibraryCirculationPage } from "@/features/library/LibraryCirculationPage";
import { LibrarySettingsPage } from "@/features/library/LibrarySettingsPage";
import { StudentLibraryPage } from "@/features/portal/StudentLibraryPage";
import { TransportPage } from "@/features/transport/TransportPage";
import { EventsCalendarPage } from "@/features/events/EventsCalendarPage";
import { ReportsPage } from "@/features/reports/ReportsPage";
import { IDCardBatchPage } from "@/features/id-cards/IDCardBatchPage";
import { LeavingCertificatesPage } from "@/features/students/LeavingCertificatesPage";
import { StudentLeaveRequestsPage } from "@/features/students/StudentLeaveRequestsPage";

import { EmployeeListPage } from "@/features/hr/EmployeeListPage";
import { StaffProfilePage } from "@/features/hr/StaffProfilePage";
import { StaffRegistrationPage } from "@/features/hr/StaffRegistrationPage";
import { PortalInvitationPage } from "@/features/hr/PortalInvitationPage";
import { StaffIdCardPage } from "@/features/hr/StaffIdCardPage";
import { LeaveApprovalsPage } from "@/features/hr/LeaveApprovalsPage";
import { PayrollRunsPage } from "@/features/hr/PayrollRunsPage";
import { PayrollRunDetailPage } from "@/features/hr/PayrollRunDetailPage";
import { MyTimetablePage } from "@/features/hr/MyTimetablePage";
import { MyClassesPage } from "@/features/hr/MyClassesPage";
import { MyLeavePage } from "@/features/hr/MyLeavePage";
import { MyPayslipsPage } from "@/features/hr/MyPayslipsPage";

import { PortalHomePage } from "@/features/portal/PortalHomePage";
import { StudentTimetablePage } from "@/features/portal/StudentTimetablePage";
import { StudentGradesPage } from "@/features/portal/StudentGradesPage";
import { StudentAttendancePage } from "@/features/portal/StudentAttendancePage";
import { StudentAssignmentsPage } from "@/features/portal/StudentAssignmentsPage";
import { ParentChildPage } from "@/features/portal/ParentChildPage";
import { ParentPaymentPage } from "@/features/portal/ParentPaymentPage";
import { ParentInvoiceDetailPage } from "@/features/portal/ParentInvoiceDetailPage";

import { AcademicYearsPage } from "@/features/settings/AcademicYearsPage";
import { PromotionPage } from "@/features/settings/PromotionPage";
import { GradingScalesPage } from "@/features/settings/GradingScalesPage";
import { BrandingPage } from "@/features/settings/BrandingPage";
import { IdCardTemplateDesignerPage } from "@/features/settings/IdCardTemplateDesignerPage";
import { AccessManagementPage } from "@/features/settings/access/AccessManagementPage";
import { CalendarPreferencesPage } from "@/features/settings/CalendarPreferencesPage";
import { ClassesPage } from "@/features/settings/ClassesPage";
import { ClassDetailPage } from "@/features/settings/ClassDetailPage";
import { SubjectsPage } from "@/features/settings/SubjectsPage";
import { TeachersPage } from "@/features/settings/TeachersPage";
import { AuditLogsPage } from "@/features/settings/AuditLogsPage";
import { BackupsPage } from "@/features/settings/BackupsPage";
import { ConfigurationPage } from "@/features/settings/ConfigurationPage";
import { ImportExportPage } from "@/features/settings/ImportExportPage";
import { HealthMonitoringPage } from "@/features/settings/HealthMonitoringPage";
import { CustomReportBuilderPage } from "@/features/reports/CustomReportBuilderPage";
import { FinancialReportPage } from "@/features/reports/FinancialReportPage";
import { FeesReportPage } from "@/features/reports/FeesReportPage";
import { HRPayrollReportPage } from "@/features/reports/HRPayrollReportPage";
import { UsersAuditReportPage } from "@/features/reports/UsersAuditReportPage";

import { TenantsManagementPage } from "@/features/platform/TenantsManagementPage";
import { TenantDetailPage } from "@/features/platform/TenantDetailPage";
import { ModulesMatrixPage } from "@/features/platform/ModulesMatrixPage";
import { IntegrationsPage } from "@/features/platform/IntegrationsPage";
import { BillingPage } from "@/features/platform/BillingPage";
import { StatutoryConfigPage } from "@/features/platform/StatutoryConfigPage";
import { PlatformReportPage } from "@/features/platform/PlatformReportPage";
import { SecuritySettingsPage } from "@/features/platform/SecuritySettingsPage";

import { PublicAdmissionFormPage } from "@/features/public/PublicAdmissionFormPage";
import { AdmissionStatusPage } from "@/features/public/AdmissionStatusPage";
import { IDVerificationPage } from "@/features/public/IDVerificationPage";

const FINANCE = ["school_admin", "accountant"];
const HR = ["school_admin", "hr_officer"];
const HR_FINANCE = ["school_admin", "hr_officer", "accountant"];
const TEACH = ["school_admin", "teacher"];
const ADMIN_REG = ["school_admin", "registrar"];
const LIBRARY = ["school_admin", "librarian"];

export const router = createBrowserRouter([
  // ---------- Public (no session) ----------
  { path: "/login", element: <LoginPage /> },
  { path: "/accept-invite", element: <AcceptInvitePage /> },
  { path: "/auth/sso-callback", element: <SsoCallbackPage /> },
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
          // Any staff role, no module gate -- messaging isn't a toggleable
          // module, and RLS (sender/recipient only) is the real access gate.
          { path: "messages", element: <MessagesPage /> },

          // Same "not a toggleable module, RLS is the real gate" call as
          // messages -- school_admin or the student's own class teacher.
          {
            element: <RequireRole roles={TEACH} />,
            children: [{ path: "student-leave-requests", element: <StudentLeaveRequestsPage /> }],
          },

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
                  { path: "admissions", element: <AdmissionsListPage /> },
                  { path: "admissions/:id", element: <AdmissionDetailPage /> },
                ],
              },
              {
                element: <RequireModule module="id_cards" />,
                children: [{ path: "id-cards", element: <IDCardBatchPage /> }],
              },
              // Leaving certificates -- despite the naming similarity, this is
              // NOT the id_cards module; it's available at every tier, so it
              // stays outside any RequireModule wrapper (see
              // 20260827000001_leaving_certificates.sql).
              { path: "leaving-certificates", element: <LeavingCertificatesPage /> },
            ],
          },

          // Admin: Academic setup. classes/subjects/settings/* are core
          // tenant configuration, not one of the 18 subscription modules —
          // left ungated. The rest each map to their own module.
          {
            element: <RequireRole roles={["school_admin"]} />,
            children: [
              { path: "classes", element: <ClassesPage /> },
              { path: "classes/:id", element: <ClassDetailPage /> },
              { path: "subjects", element: <SubjectsPage /> },
              { path: "settings/teachers", element: <TeachersPage /> },
              {
                element: <RequireModule module="fees" />,
                children: [{ path: "fees/structures", element: <FeeStructuresPage /> }],
              },
              {
                element: <RequireModule module="communication" />,
                children: [
                  { path: "communication", element: <AnnouncementsPage /> },
                  { path: "communication/notices", element: <NoticesPage /> },
                ],
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
              { path: "settings/access", element: <AccessManagementPage /> },
              { path: "settings/users", element: <Navigate to="/settings/access" replace /> },
              { path: "settings/roles", element: <Navigate to="/settings/access" replace /> },
              { path: "settings/permissions-matrix", element: <Navigate to="/settings/access" replace /> },
              { path: "settings/configuration", element: <ConfigurationPage /> },
              { path: "settings/import-export", element: <ImportExportPage /> },
              { path: "settings/health-monitoring", element: <HealthMonitoringPage /> },
              { path: "reports/custom", element: <CustomReportBuilderPage /> },
              { path: "settings/audit-logs", element: <AuditLogsPage /> },
              { path: "settings/backups", element: <BackupsPage /> },
              { path: "settings/calendar", element: <CalendarPreferencesPage /> },
              { path: "reports/users-audit", element: <UsersAuditReportPage /> },
            ],
          },

          // Admin + Accountant: Fees, Inventory, Reports
          {
            element: <RequireRole roles={FINANCE} />,
            children: [
              {
                element: <RequireModule module="fees" />,
                children: [
                  { path: "fees/invoices", element: <InvoicesPage /> },
                  { path: "fees/invoices/:id", element: <InvoiceDetailPage /> },
                ],
              },
              {
                element: <RequireModule module="inventory" />,
                children: [{ path: "inventory", element: <InventoryPage /> }],
              },
              {
                element: <RequireModule module="reporting" />,
                children: [
                  { path: "reports", element: <ReportsPage /> },
                  { path: "reports/financial", element: <FinancialReportPage /> },
                  { path: "reports/fees", element: <FeesReportPage /> },
                ],
              },
            ],
          },

          // Library (school_admin + librarian): catalog/copies, circulation
          // desk, and settings each their own path but all module-gated
          // together, mirroring the Admin+Accountant FINANCE block above.
          {
            element: <RequireRole roles={LIBRARY} />,
            children: [
              {
                element: <RequireModule module="library" />,
                children: [
                  { path: "library", element: <LibraryCatalogPage /> },
                  { path: "library/circulation", element: <LibraryCirculationPage /> },
                  { path: "settings/library", element: <LibrarySettingsPage /> },
                ],
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
                  { path: "assignments/:assignmentId", element: <AssignmentFormPage /> },
                ],
              },
            ],
          },
          {
            element: <RequireModule module="timetable" />,
            children: [
              { path: "my/timetable", element: <MyTimetablePage /> },
              { path: "my/classes", element: <MyClassesPage /> },
            ],
          },

          // HR & Payroll
          {
            element: <RequireRole roles={HR} />,
            children: [
              {
                element: <RequireModule module="hr_payroll" />,
                children: [
                  { path: "hr/employees", element: <EmployeeListPage /> },
                  { path: "hr/employees/new", element: <StaffRegistrationPage /> },
                  { path: "hr/employees/:id", element: <StaffProfilePage /> },
                  { path: "hr/employees/:id/invite", element: <PortalInvitationPage /> },
                  { path: "hr/employees/:id/id-card", element: <StaffIdCardPage /> },
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
                  { path: "reports/hr-payroll", element: <HRPayrollReportPage /> },
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

          // Portal home -- shared "portal" path, student vs. parent branches
          // inside PortalHomePage. Two sibling routes at the same path
          // previously collided (see PortalHomePage's comment); this is the
          // fix, not a stylistic preference.
          {
            element: <RequireRole roles={["student", "parent"]} />,
            children: [
              { path: "portal", element: <PortalHomePage /> },
              {
                element: <RequireModule module="library" />,
                children: [{ path: "portal/library", element: <StudentLibraryPage /> }],
              },
            ],
          },

          // Student self-service
          {
            element: <RequireRole roles={["student"]} />,
            children: [
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
              { path: "portal/child/:id", element: <ParentChildPage /> },
              { path: "portal/pay", element: <ParentPaymentPage /> },
              { path: "portal/pay/:id", element: <ParentInvoiceDetailPage /> },
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
              { path: "reports", element: <PlatformReportPage /> },
              { path: "statutory", element: <StatutoryConfigPage /> },
              { path: "security", element: <SecuritySettingsPage /> },
            ],
          },
        ],
      },
    ],
  },

  { path: "*", element: <Navigate to="/" replace /> },
]);
