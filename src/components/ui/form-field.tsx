import { Label } from "./label";
import { cn } from "@/lib/utils";

/**
 * Accessibility metadata a field hands to its control (DEV-UI-01.6). Spread it onto the element that
 * actually receives focus — an <Input>, a <Textarea>, or a Radix <SelectTrigger> (never the Select root).
 */
export type FieldProps = {
  id: string;
  /** Space-separated ids of the description / error text, or undefined when there is none. */
  describedBy: string | undefined;
  /** True while an error is shown. */
  invalid: true | undefined;
  /** True when the field is required. */
  required: true | undefined;
};

/** The ids a field derives from its control id, so callers and tests can reference them. */
export function fieldIds(htmlFor: string) {
  return { description: `${htmlFor}-description`, error: `${htmlFor}-error` };
}

// The label + control + description + error layout every create/edit form repeats. `htmlFor` is the
// control's id. Callers either render their own control as ordinary children (the original contract,
// unchanged), or pass a render function and receive the field's accessibility metadata to put on the
// control themselves. Nothing is cloned onto children: a composite control (a Radix Select) needs the
// attributes on an inner element, which only the caller knows.
export function FormField({
  label,
  htmlFor,
  description,
  required,
  error,
  span,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  /** Help text under the label, referenced by aria-describedby. */
  description?: string;
  /** Shows the required mark; render-function consumers also receive `required`. */
  required?: boolean;
  error?: string;
  span?: 2;
  className?: string;
  children: React.ReactNode | ((field: FieldProps) => React.ReactNode);
}) {
  const ids = fieldIds(htmlFor);
  const describedBy = [description ? ids.description : null, error ? ids.error : null].filter(Boolean).join(" ") || undefined;
  const field: FieldProps = { id: htmlFor, describedBy, invalid: error ? true : undefined, required: required ? true : undefined };
  return (
    <div className={cn("flex flex-col gap-1.5", span === 2 && "col-span-2", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {" "}*
          </span>
        )}
      </Label>
      {description && (
        <p id={ids.description} className="text-caption text-ink-faint">
          {description}
        </p>
      )}
      {typeof children === "function" ? children(field) : children}
      {error && (
        <p id={ids.error} className="text-caption text-danger" data-field-error="">
          {error}
        </p>
      )}
    </div>
  );
}
