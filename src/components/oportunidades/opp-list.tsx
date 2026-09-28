import Link from "next/link";
import { dealflowStage, opportunityRoute, opportunityStatus } from "@/domain/catalogs";
import { EmptyState, Pill, formatDate } from "@/components/app/bits";

export type OppRow = {
  id: string;
  title: string;
  route: string;
  status: string;
  stage: string | null;
  next_action: string | null;
  next_action_due: string | null;
  created_at: string;
  opportunity_findings: { count: number }[];
  decisions: { status: string; kind: string }[];
};

export function OppList({ slug, rows, empty }: { slug: string; rows: OppRow[]; empty: string }) {
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((o) => {
        const pendingApproval = o.decisions.some((d) => d.kind === "aprobar_oportunidad" && d.status === "requested");
        return (
          <li key={o.id}>
            <Link href={`/w/${slug}/oportunidades/o/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-muted/50">
              <div className="min-w-0">
                <div className="font-medium">{o.title}</div>
                <div className="text-sm text-muted-foreground">
                  {opportunityRoute.label(o.route)} · {o.opportunity_findings[0]?.count ?? 0} hallazgos · creada {formatDate(o.created_at)}
                  {o.next_action && ` · ${o.next_action}`}
                </div>
              </div>
              <div className="flex gap-2">
                {pendingApproval && <Pill className="border-amber-400 text-amber-800 dark:text-amber-300">Aprobación pendiente</Pill>}
                <Pill>{o.stage ? dealflowStage.label(o.stage) : opportunityStatus.label(o.status)}</Pill>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export const oppListSelect =
  "id, title, route, status, stage, next_action, next_action_due, created_at, opportunity_findings(count), decisions(status, kind)";
