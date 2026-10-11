// A contents list at the top of each legal document. Both pages are long enough that a reader
// looking for one thing — "how do I cancel", "who sees my email" — was otherwise reduced to
// scrolling, and a numbered, linkable section list is the convention these documents use for
// exactly that reason. The ids it points at also give support and the pages themselves something
// stable to deep-link to (/privacy#payments). The French documents keep the same ids, so a link
// to /fr/privacy#payments lands on the same section.
export default function LegalToc({ sections, label = "Contents" }: { sections: ReadonlyArray<readonly [string, string]>; label?: string }) {
  return (
    <nav className="legal-toc" aria-label={label}>
      <h2>{label}</h2>
      <ul>
        {sections.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`}>{label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
