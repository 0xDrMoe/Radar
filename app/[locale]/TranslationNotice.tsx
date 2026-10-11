// Said at the top of every French legal document until a professional translation replaces it.
//
// The Charter of the French Language (s. 55, as amended by Bill 96) requires Quebec readers to be
// offered these documents in French. The operator approved machine translation for now, so the
// French is published, and the reader is told plainly what it is and where to ask when a passage
// reads wrong.
// It deliberately does not say the English version prevails: for a Quebec consumer the French
// version of an adhesion contract is the one they are entitled to rely on.
export default function TranslationNotice() {
  return (
    <p className="legal-notice">
      <strong>Traduction automatique.</strong> Cette version française a été produite par traduction
      automatique, en attendant une traduction professionnelle qui est en cours. Si un passage vous
      semble inexact ou ambigu, écrivez-nous à{" "}
      <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> et nous le
      corrigerons.
    </p>
  );
}
