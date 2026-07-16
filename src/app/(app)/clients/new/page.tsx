import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ClientForm } from "../client-form";
import { createClientAction } from "../actions";

export default function NewClientPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="New Client" description="Add a client to bill and quote against." />
      <Card>
        <CardContent className="pt-6">
          <ClientForm action={createClientAction} submitLabel="Create Client" />
        </CardContent>
      </Card>
    </div>
  );
}
