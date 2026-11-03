import { redirect } from "next/navigation";
import { NewListingForm } from "@/components/NewListingForm";
import { isSeller } from "@/lib/seller-auth";

export default async function NewListingPage() {
  if (!(await isSeller())) redirect("/seller/login?next=/seller/new");
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New listing</h1>
        <p className="text-muted">Add photos and a few words. Your assistant writes the listing and checks today&apos;s price.</p>
      </div>
      <NewListingForm />
    </div>
  );
}
