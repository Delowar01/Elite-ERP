import { Label } from "./label";
import { cn } from "@/lib/utils";

// The label + control + error layout every create/edit form repeats. Callers still render their
// own <Input>/<Select>/etc as children — this only owns the surrounding layout and error text.
export function FormField({
  label,
  htmlFor,
  error,
  span,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  span?: 2;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", span === 2 && "col-span-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
