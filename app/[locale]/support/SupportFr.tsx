import ChromeLink from "../../ChromeLink";
import LegalToc from "../LegalToc";
import TranslationNotice from "../TranslationNotice";
import { SUPPORT_PHONE } from "../../business-contact";

// French translation of page.tsx's article. The section ids are the same as the English ones so a
// deep link (/fr/support#pro) lands on the same section. Keep it in step with the English: any
// change to page.tsx's prose needs the matching change here.
export const SUPPORT_FR_META = {
  title: "Aide — Radar",
  description:
    "Comment obtenir de l’aide avec Radar\u00A0: nous joindre, comptes et connexion, alertes d’offres, facturation et annulation de Radar Pro, localisation, signaler une offre et supprimer vos données.",
};

const SECTIONS = [
  ["contact", "1. Nous joindre"],
  ["coverage", "2. Où Radar est offert"],
  ["account", "3. Comptes et connexion"],
  ["alerts", "4. Zones suivies et alertes d’offres"],
  ["pro", "5. Radar Pro, facturation et annulation"],
  ["location", "6. Localisation"],
  ["listings", "7. Une offre est erronée, expirée ou manquante"],
  ["data", "8. Vos données et la suppression de votre compte"],
  ["accessibility", "9. Accessibilité"],
  ["restaurants", "10. Propriétaires de restaurants"],
] as const;

export default function SupportFr() {
  return (
    <article lang="fr">
      <span className="kicker">AIDE</span>
      <h1>Aide avec Radar</h1>
      <p className="lead">
        Radar est une application de répertoire&nbsp;: elle affiche les offres des restaurants près de
        chez vous, avec les jours et les heures où chacune s’applique. Si quelque chose ne fonctionne
        pas, ou si une offre est erronée, écrivez à{" "}
        <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> et une
        personne lira votre message. Le reste de cette page répond aux questions qu’on nous pose le
        plus souvent.
      </p>

      <TranslationNotice />

      <LegalToc sections={SECTIONS} label="Table des matières" />

      <h2 id="contact">1. Nous joindre</h2>
      <p>
        <strong>
          <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a>
        </strong>{" "}
        pour absolument tout — un bogue, une question, une offre erronée, un compte auquel vous ne
        pouvez pas accéder ou un paiement que vous aimeriez qu’on examine. Nous visons à répondre
        dans un délai de deux jours ouvrables.
      </p>
      <p>
        Vous pouvez aussi nous appeler au <a href={`tel:${SUPPORT_PHONE.tel}`}>{SUPPORT_PHONE.display}</a>.
      </p>
      <p>
        Cela nous aide, sans être obligatoire, que vous nous indiquiez l’appareil et la version de
        l’application que vous utilisez, la ville que vous cherchiez et ce à quoi vous vous attendiez.
      </p>
      <p>
        Les demandes relatives à la vie privée — accès, rectification, suppression, portabilité —
        sont envoyées à la même adresse, à l’attention de notre responsable de la protection des
        renseignements personnels. Indiquez «&nbsp;demande relative à la vie privée&nbsp;» dans
        l’objet du message, afin qu’elles soient traitées dans les délais auxquels s’engage la{" "}
        <ChromeLink href="/privacy#rights">Politique de confidentialité</ChromeLink>.
      </p>

      <h2 id="coverage">2. Où Radar est offert</h2>
      <p>
        Radar répertorie des offres de restaurants dans des villes partout au Canada et dans un plus
        petit nombre de villes américaines. La couverture est la plus complète à Ottawa et dans les
        environs. Ailleurs au Canada, de Victoria à St. John’s, une ville peut ne compter qu’une
        poignée d’offres plutôt qu’un portrait complet, et il en va de même pour les villes
        américaines qui ont des offres locales. Nous ajoutons des endroits au fil de nos recherches
        et à mesure que des restaurants et des lecteurs nous envoient des offres.
      </p>
      <p>
        Les chaînes de restaurants dont les promotions s’appliquent dans les établissements
        participants de tout un pays, au Canada ou aux États-Unis, sont regroupées dans une section
        nationale plutôt que mêlées aux résultats locaux. Cette section reste masquée tant que vous
        n’activez pas <strong>Chaînes de restaurants</strong>, et c’est là que se trouvent la
        plupart des offres américaines de Radar.
      </p>
      <p>
        Les résultats sont limités à un rayon autour de l’endroit recherché, que vous pouvez
        élargir. Lorsque seules quelques offres s’y trouvent, Radar propose de chercher plus loin,
        et le site Web indique aussi quand la couverture d’une région est encore en croissance. Si
        aucune offre ne se trouve dans le rayon, la liste reste vide plutôt que d’être remplie
        d’offres venant d’ailleurs. C’est voulu&nbsp;: une application d’offres qui remplit l’écran
        d’offres situées deux provinces plus loin est pire qu’une application qui admet n’avoir rien
        pour vous.
      </p>
      <p>
        Vous n’avez pas besoin d’être dans une ville couverte pour la consulter. Ouvrez la
        recherche, touchez <strong>Changer</strong> à côté de l’emplacement en haut, puis tapez un
        nom de ville ou un code postal ou code ZIP.
      </p>

      <h2 id="account">3. Comptes et connexion</h2>
      <p>
        <strong>Vous n’avez pas besoin d’un compte pour utiliser Radar.</strong> La navigation, la
        recherche, la carte et les filtres fonctionnent tous sans connexion. Un compte n’est
        nécessaire que pour enregistrer des offres, suivre des zones et recevoir des alertes.
      </p>
      <p>
        La connexion est gérée par Clerk, avec une adresse courriel ou un compte Google ou Apple
        associé. Si un courriel de connexion n’arrive pas, vérifiez d’abord le dossier des courriels
        indésirables. Si l’adresse associée au compte est une adresse que vous ne contrôlez plus,
        écrivez-nous — nous pouvons vous aider, mais nous devrons vérifier votre identité avant de
        modifier quoi que ce soit.
      </p>

      <h2 id="alerts">4. Zones suivies et alertes d’offres</h2>
      <p>
        Une zone suivie est un endroit dont vous voulez avoir des nouvelles&nbsp;: un code postal ou code
        ZIP et un rayon autour de celui-ci. Ajoutez-en une à partir de <strong>Zones suivies</strong>{" "}
        dans votre tableau de bord. Le forfait gratuit permet de suivre une zone; Radar Pro en suit
        plusieurs.
      </p>
      <p>
        Les alertes par courriel restent désactivées jusqu’à ce que vous les confirmiez. Nous vous
        le demandons une fois, vous confirmez à partir du courriel, et vous pouvez les désactiver de
        nouveau à partir de <strong>Alertes d’offres</strong> dans votre tableau de bord ou à l’aide
        du lien de désabonnement au bas de chaque alerte. Les notifications push sur iOS suivent
        l’autorisation du système et peuvent être révoquées en tout temps dans les Réglages d’iOS.
      </p>
      <p>
        Un résumé présente jusqu’à huit des offres de votre zone suivie, le jour que vous avez
        choisi (ou les jours et l’heure que vous avez choisis, avec Radar Pro). Il n’est pas envoyé
        lorsqu’aucune offre n’est répertoriée dans le rayon de la zone; si les alertes se sont tues,
        la cause habituelle est donc une zone sans offres à proximité, et la solution consiste à
        élargir son rayon dans <strong>Zones suivies</strong>. Les alertes par courriel s’ouvrent
        aussi graduellement au public&nbsp;: si <strong>Alertes d’offres</strong> dans votre tableau de
        bord indique que vous êtes sur la liste d’attente, aucun courriel n’a encore été envoyé. Une
        fois que vous y avez accès, la même page offre un bouton qui envoie un message d’essai, ce
        qui tranche la question dans un sens ou dans l’autre.
      </p>

      <h2 id="pro">5. Radar Pro, facturation et annulation</h2>
      <p>
        Radar Pro est un abonnement, mensuel ou annuel sur le site Web et mensuel dans l’application
        iOS. Il permet de suivre plus d’une zone, envoie des alertes pour chacune d’elles, débloque
        les rayons d’alerte plus étendus, vous permet de choisir les jours et l’heure de réception
        des alertes, et rend votre historique d’alertes exportable.
      </p>
      <p>
        <strong>Si vous vous êtes abonné dans l’application iOS</strong>, l’abonnement est lié à
        votre identifiant Apple et c’est Apple qui s’occupe de la facturation. Annulez-le à partir
        de{" "}
        <a
          href="https://apps.apple.com/account/subscriptions"
          target="_blank"
          rel="noreferrer noopener"
        >
          Réglages &rsaquo; votre nom &rsaquo; Abonnements
        </a>{" "}
        sur votre appareil. Nous ne pouvons ni annuler ni rembourser un achat Apple à votre place;
        les remboursements se demandent à Apple à{" "}
        <a href="https://reportaproblem.apple.com" target="_blank" rel="noreferrer noopener">
          reportaproblem.apple.com
        </a>
        . L’accès se poursuit jusqu’à la fin de la période déjà payée.
      </p>
      <p>
        <strong>Si vous vous êtes abonné sur le site Web</strong>, la facturation passe par Stripe.
        Ouvrez <strong>Compte et confidentialité</strong> dans votre tableau de bord et utilisez{" "}
        <strong>Gérer la facturation</strong> pour changer de mode de paiement, consulter vos
        factures ou annuler.
      </p>
      <p>
        Si les fonctionnalités Pro ne s’affichent pas après un achat, déconnectez-vous puis
        reconnectez-vous d’abord — les droits d’accès sont lus à la connexion. Si cela ne règle pas
        le problème, écrivez-nous en indiquant l’adresse courriel du compte et nous arrangerons les
        choses.
      </p>

      <h2 id="location">6. Localisation</h2>
      <p>
        L’application demande l’accès à votre position afin de trier les offres selon leur distance.
        Refuser est entièrement pris en charge&nbsp;: tapez plutôt une ville, un code postal ou un code
        ZIP, et tout le reste fonctionne de la même façon. Vous pouvez changer d’avis dans un sens
        comme dans l’autre dans les Réglages d’iOS, sous Radar.
      </p>
      <p>
        Les distances sont mesurées à vol d’oiseau entre l’endroit où vous êtes et le restaurant,
        et non selon le trajet en voiture; considérez-les donc comme une indication.
      </p>

      <h2 id="listings">7. Une offre est erronée, expirée ou manquante</h2>
      <p>
        Les restaurants modifient leurs offres sans toujours le dire à qui que ce soit. Radar
        affiche ce qu’on lui a communiqué et vous indique quand il a vérifié une offre pour la
        dernière fois, ou quand il en a répertorié une qu’il n’a pas encore vérifiée, ce qui est la
        façon honnête de composer avec un problème que nous ne pouvons pas entièrement régler.{" "}
        <strong>Confirmez auprès du restaurant avant de vous déplacer</strong>, en particulier pour
        toute offre d’une durée limitée.
      </p>
      <p>
        Chaque page d’offre comporte une courte question demandant si l’offre était exacte. C’est
        le moyen le plus rapide de nous signaler qu’il y a un problème, et les réponses sont lues.
        Vous pouvez aussi envoyer le lien à{" "}
        <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a>.
      </p>
      <p>
        Pour suggérer un restaurant que nous ne répertorions pas, utilisez le formulaire de
        suggestion sur la page d’accueil. Si vous exploitez un restaurant et souhaitez nous envoyer
        ses offres ou corriger sa fiche, consultez{" "}
        <ChromeLink href="/for-restaurants">Radar pour les restaurants</ChromeLink>.
      </p>

      <h2 id="data">8. Vos données et la suppression de votre compte</h2>
      <p>
        <strong>Télécharger une copie.</strong> La section <strong>Compte et confidentialité</strong>{" "}
        de votre tableau de bord comporte un lien de téléchargement qui vous remet, sous forme de
        fichier, tout ce qui est conservé en lien avec votre compte.
      </p>
      <p>
        <strong>Supprimer le compte.</strong> Écrivez à{" "}
        <a href="mailto:support@cedartechsolutions.ca?subject=Demande%20de%20suppression%20de%20compte%20Radar">
          support@cedartechsolutions.ca
        </a>{" "}
        à partir de l’adresse associée au compte, ou utilisez le lien de suppression dans{" "}
        <strong>Compte et confidentialité</strong>. La suppression du compte efface votre profil,
        vos offres enregistrées, vos zones suivies, vos paramètres d’alerte, votre historique de
        consentement aux courriels et votre historique d’envois. Quelques dossiers lui survivent
        sous une forme réduite, pour les raisons et les durées énoncées dans la{" "}
        <ChromeLink href="/privacy#retention">Politique de confidentialité</ChromeLink>&nbsp;: une adresse
        qui s’est désabonnée ou dont les courriels ont été rejetés reste sur notre liste
        d’exclusion afin de ne plus jamais recevoir de courriel, les dossiers de facturation sont
        conservés aussi longtemps que l’exige la législation fiscale, et une offre que vous avez
        suggérée peut rester publiée sans votre nom ni votre adresse courriel.
      </p>
      <p>
        La suppression d’un compte Radar n’annule pas un abonnement Apple — annulez-le séparément,
        comme il est décrit ci-dessus, sinon Apple continuera de vous facturer.
      </p>

      <h2 id="accessibility">9. Accessibilité</h2>
      <p>
        Nous visons à ce que le site Web et les applications Radar respectent les Règles pour
        l’accessibilité des contenus Web (WCAG) 2.2 au niveau AA, et nous les concevons pour
        fonctionner avec les lecteurs d’écran, la navigation au clavier seulement et le texte
        agrandi. Si quelque chose sur Radar est difficile à utiliser en raison d’un handicap ou
        avec une technologie d’assistance, écrivez à{" "}
        <a href="mailto:support@cedartechsolutions.ca?subject=Accessibilit%C3%A9">support@cedartechsolutions.ca</a>{" "}
        en indiquant «&nbsp;Accessibilité&nbsp;» dans l’objet, et précisez la page ou l’écran où vous
        étiez et ce que vous tentiez de faire. Nous répondons dans un délai de 5&nbsp;jours
        ouvrables. Sur demande, nous fournirons gratuitement toute information figurant sur Radar,
        y compris nos Conditions d’utilisation et notre Politique de confidentialité, dans un format
        accessible ou avec un soutien à la communication.
      </p>
      <p>
        L’application iOS prend en charge VoiceOver, Contrôle vocal, Taille du texte dynamique aux
        tailles d’accessibilité, le Mode sombre, Augmenter le contraste et Réduire les animations.
        Si vous tombez sur quelque chose qui ne fonctionne pas avec la technologie d’assistance que
        vous utilisez, dites-nous ce que vous tentiez de faire et quel réglage était activé. Ces
        signalements sont la façon dont les lacunes sont repérées, et ils sont traités comme des
        bogues plutôt que comme des demandes.
      </p>
      <p>
        Radar ne contient aucun contenu vidéo ou audio; rien n’y nécessite donc de sous-titres ni
        d’audiodescription.
      </p>

      <h2 id="restaurants">10. Propriétaires de restaurants</h2>
      <p>
        Si vous exploitez un restaurant que nous répertorions et que quelque chose est erroné, ou si
        vous aimeriez y figurer,{" "}
        <ChromeLink href="/for-restaurants">Radar pour les restaurants</ChromeLink> propose un
        formulaire pour nous envoyer une offre ou une correction, et il nous parvient directement.
        Chaque envoi est vérifié par rapport à la source que vous fournissez avant que quoi que ce
        soit ne soit publié. Les restaurants ne peuvent pas encore revendiquer ni modifier leur
        propre page; le portail restaurant est accessible sur invitation seulement. Les demandes de
        retrait sont respectées — écrivez à{" "}
        <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> en
        incluant le lien vers la fiche.
      </p>
    </article>
  );
}
