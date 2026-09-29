import "server-only";

import type { Place } from "@/domain/maps";

export type EntityKind = "company" | "establishment" | "asset";

export const entityTable = {
  company: "companies",
  establishment: "establishments",
  asset: "assets",
} as const;

export const entityFk = {
  company: "company_id",
  establishment: "establishment_id",
  asset: "asset_id",
} as const;

export function isEntityKind(v: string): v is EntityKind {
  return v === "company" || v === "establishment" || v === "asset";
}

type CompanyLite = { id: string; trade_name: string | null; legal_name: string | null; locality?: string | null; is_demo?: boolean; verification_status?: string };
type PlaceLite = Place & { id: string; is_demo?: boolean; verification_status?: string };
type EstablishmentLite = PlaceLite & { name: string };
type AssetLite = PlaceLite & { title: string; kind?: string; operation?: string };

export type TargetEntityRefs = {
  company?: CompanyLite | null;
  establishment?: EstablishmentLite | null;
  asset?: AssetLite | null;
};

export type ResolvedEntity = {
  kind: EntityKind;
  id: string;
  name: string;
  place: Place | null;
  isDemo: boolean;
  verification: string;
  subtype?: string;
};

export function companyName(c: { trade_name: string | null; legal_name: string | null }) {
  return c.trade_name || c.legal_name || "(sin nombre)";
}

export function resolveTargetEntity(t: TargetEntityRefs): ResolvedEntity | null {
  if (t.company) {
    return {
      kind: "company",
      id: t.company.id,
      name: companyName(t.company),
      place: null,
      isDemo: !!t.company.is_demo,
      verification: t.company.verification_status ?? "unverified",
    };
  }
  if (t.establishment) {
    return {
      kind: "establishment",
      id: t.establishment.id,
      name: t.establishment.name,
      place: t.establishment,
      isDemo: !!t.establishment.is_demo,
      verification: t.establishment.verification_status ?? "unverified",
    };
  }
  if (t.asset) {
    return {
      kind: "asset",
      id: t.asset.id,
      name: t.asset.title,
      place: t.asset,
      isDemo: !!t.asset.is_demo,
      verification: t.asset.verification_status ?? "unverified",
      subtype: t.asset.kind,
    };
  }
  return null;
}

const placeCols = "address_text, locality, province, country, address_status, latitude, longitude";

/** Columnas para embeber la entidad de un target (company/establishment/asset). */
export const targetEntitySelect = `
  company:companies(id, trade_name, legal_name, locality, is_demo, verification_status),
  establishment:establishments(id, name, ${placeCols}, is_demo, verification_status),
  asset:assets(id, title, kind, operation, ${placeCols}, is_demo, verification_status)
`;

export function entityHref(slug: string, kind: EntityKind, id: string) {
  return `/w/${slug}/e/${kind}/${id}`;
}

export type EntityFkFields = { company_id?: string; establishment_id?: string; asset_id?: string };

/** `{ company_id: id }` / `{ establishment_id: id }` / `{ asset_id: id }` con tipos correctos. */
export function entityFkFields(kind: EntityKind, id: string): EntityFkFields {
  return { [entityFk[kind]]: id } as EntityFkFields;
}
