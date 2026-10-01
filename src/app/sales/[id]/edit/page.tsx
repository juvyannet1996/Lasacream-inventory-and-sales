import { SaleScreen } from "@/components/SaleScreen";

export const metadata = { title: "Edit sale" };

export default async function EditSalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SaleScreen saleId={id} />;
}
