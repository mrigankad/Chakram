import { BarChart, DataTable, DonutChart, Grid, Mark, PageBody, PageHeader, Panel, ProgressBars, StatusBadge, count as formatCount, usd } from '../chronos';
import type { Column, StatusTone } from '../chronos';
import { appointments, doctors } from '../data/seed';
import type { Doctor } from '../data/types';
import { latest, lookup, series, top } from '../data/queries';
import ShiftPlanner from '../components/ShiftPlanner';

const appointmentStatusTone: Record<string, StatusTone> = { "scheduled": "info", "done": "success", "cancelled": "error" };

const doctorSpecialityTone: Record<string, StatusTone> = { "Cardiology": "neutral", "Dermatology": "neutral", "General": "neutral" };

const doctorsColumns: Column<Doctor>[] = [
  { key: "name", header: "Name", render: (r) => r.name, value: (r) => r.name },
  { key: "speciality", header: "Speciality", render: (r) => <StatusBadge tone={doctorSpecialityTone[r.speciality] ?? 'neutral'}>{r.speciality}</StatusBadge>, value: (r) => r.speciality },
  { key: "email", header: "Email", render: (r) => r.email, value: (r) => r.email },
];

export default function Doctors() {
  return (
    <PageBody>
      <PageHeader title="Doctors" mark={<Mark id="mark-command" size={44} />} />
      <Grid>
        <Panel title="By speciality">
          <DonutChart data={top(doctors, "speciality", { fn: "count" }, 6)} format="number" ariaLabel="By speciality" />
        </Panel>
        <Panel title="Appointments by status">
          <ProgressBars entries={top(appointments, "status", { fn: "count" }, 6).map((d) => ({ id: d.id, label: d.label, value: d.value, valueLabel: formatCount(d.value) }))} />
        </Panel>
        <Panel title="Latest" padded={false}>
          <ul className="divide-y divide-muted">
            {latest(appointments, "start", 6).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-body-md text-primary">{row.patient}</span>
                  <span className="block truncate text-body-sm text-tertiary">{usd(row.fee)}</span>
                </span>
                <StatusBadge tone={appointmentStatusTone[row.status] ?? 'neutral'}>{row.status}</StatusBadge>
              </li>
            ))}
          </ul>
        </Panel>
      </Grid>
      <Panel title="Revenue by doctor">
        <BarChart data={series(appointments, "doctor", "value", [{ key: 's1', fn: "sum", field: "fee" }]).map((p) => ({ ...p, key: ((key) => lookup(doctors, key, "name"))(p.key) }))} x="key" series={[{ key: 's1', name: "Revenue" }]} format="currency" height={240} ariaLabel="Revenue by doctor" orientation="horizontal" />
      </Panel>
      <Panel title="Doctor" padded={false} className="flex h-[480px] min-h-0 flex-col">
        <DataTable rows={doctors} columns={doctorsColumns} rowKey={(r) => r.id} exportName="doctors" />
      </Panel>
      <Panel title="Notes">
        <p className="text-body-md text-secondary">{"Seed data only; connect the API before go-live."}</p>
      </Panel>
      <ShiftPlanner />
    </PageBody>
  );
}
