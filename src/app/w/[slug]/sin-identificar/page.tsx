import { redirect } from "next/navigation";

// Vive dentro de Red; se mantiene la ruta anterior.
export default async function Legacy({ params }: PageProps<"/w/[slug]/sin-identificar">) {
  const { slug } = await params;
  redirect(`/w/${slug}/explorar/sin-identificar`);
}
