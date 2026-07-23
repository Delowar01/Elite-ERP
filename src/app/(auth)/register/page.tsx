import { getLocale } from "@/lib/i18n/server";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  const locale = await getLocale();
  return <RegisterForm locale={locale} />;
}
