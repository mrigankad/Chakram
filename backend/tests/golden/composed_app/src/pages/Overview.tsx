import { BarList, DataTable, EmptyState, KpiGrid, KpiTile, LineChart, Mark, PageBody, PageHeader, Panel, SplitRow, StatusBadge, count as formatCount, percent, shortDate, usd, usdCompact } from '../chronos';
import type { Column, StatusTone } from '../chronos';
import { useAppData } from '../data/store';
import type { Appointment } from '../data/types';
import { count, lookup, metric, series, top } from '../data/queries';

const appointmentStatusTone: Record<string, StatusTone> = { "scheduled": "info", "done": "success", "cancelled": "error" };

export default function Overview() {
  const { ready, appointments, doctors } = useAppData();
  if (!ready) {
    return (
      <PageBody>
        <PageHeader title="Overview" description="Today at a glance" mark={<Mark id="mark-command" size={44} />} />
        <EmptyState title="Loading…" detail="Fetching data from the API." />
      </PageBody>
    );
  }
  const appointmentsColumns: Column<Appointment>[] = [
    { key: "patient", header: "Patient", render: (r) => r.patient, value: (r) => r.patient },
    { key: "doctor", header: "Doctor", render: (r) => lookup(doctors, r.doctor, "name"), value: (r) => lookup(doctors, r.doctor, "name") },
    { key: "start", header: "Start", render: (r) => shortDate(r.start), value: (r) => r.start },
    { key: "status", header: "Status", render: (r) => <StatusBadge tone={appointmentStatusTone[r.status] ?? 'neutral'}>{r.status}</StatusBadge>, value: (r) => r.status },
    { key: "fee", header: "Fee", render: (r) => usd(r.fee), value: (r) => r.fee, align: "right" },
    { key: "paid", header: "Paid", render: (r) => (r.paid ? 'Yes' : 'No'), value: (r) => r.paid },
  ];
  return (
    <PageBody>
      <PageHeader title="Overview" description="Today at a glance" mark={<Mark id="mark-command" size={44} />} />
      <KpiGrid>
        <KpiTile label="Appointments" value={formatCount(count(appointments))} />
        <KpiTile label="Revenue" value={usdCompact(metric(appointments, { fn: "sum", field: "fee" }))} />
        <KpiTile label="Done" value={formatCount(count(appointments, { field: "status", op: "eq", value: "done" }))} tone="success" />
        <KpiTile label="Avg satisfaction" value={percent(metric(appointments, { fn: "avg", field: "satisfaction" }))} />
      </KpiGrid>
      <SplitRow ratio="1.4/1">
        <Panel title="Appointments per day">
          <LineChart data={series(appointments, "start", "day", [{ key: 's1', fn: "count" }, { key: 's2', fn: "sum", field: "fee" }])} x="key" series={[{ key: 's1', name: "Appointments" }, { key: 's2', name: "Revenue" }]} format="number" height={240} ariaLabel="Appointments per day" />
        </Panel>
        <Panel title="Top doctors">
          <BarList rows={top(appointments, "doctor", { fn: "count" }, 5, (key) => lookup(doctors, key, "name"))} formatValue={(n) => formatCount(n)} />
        </Panel>
      </SplitRow>
      <Panel title="Recent appointments" padded={false} className="flex h-[480px] min-h-0 flex-col">
        <DataTable rows={appointments} columns={appointmentsColumns} rowKey={(r) => r.id} defaultSort={{ key: "start", dir: "desc" }} exportName="appointments" />
      </Panel>
    </PageBody>
  );
}
