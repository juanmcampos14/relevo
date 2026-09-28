import { ExplorarTabs } from "@/components/explorar/tabs";

export default async function ExplorarLayout({ children, params }: LayoutProps<"/w/[slug]/explorar">) {
  const { slug } = await params;
  return (
    <>
      <ExplorarTabs slug={slug} />
      {children}
    </>
  );
}
