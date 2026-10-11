import NotFoundContent from "../NotFoundContent";

export const metadata = { title: "Page not found — Radar", robots: { index: false, follow: false } };

export default function OperatorNotFound() {
  return <NotFoundContent />;
}
