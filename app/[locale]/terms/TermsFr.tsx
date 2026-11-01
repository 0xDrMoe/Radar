import ChromeLink from "../../ChromeLink";
import LegalToc from "../LegalToc";
import TranslationNotice from "../TranslationNotice";
import { TERMS_LAST_UPDATED, legalDate } from "../legal-meta";
import { SUPPORT_PHONE } from "../../business-contact";

// French translation of page.tsx's article. The section ids are the same as the English ones so
// deep links (/fr/terms#plans) land on the same section. Keep this in step with the English: a
// change to one document is a change to both.
export const TERMS_FR_META = {
  title: "Conditions d’utilisation — Radar",
  description:
    "Les conditions qui régissent l’utilisation de Radar, notamment les comptes, les abonnements Radar Pro, les contributions de la communauté et la responsabilité.",
};

const SECTIONS = [
  ["scope", "1. Entre qui ces conditions sont conclues"],
  ["service", "2. Ce que Radar fournit"],
  ["accuracy", "3. L’exactitude des offres n’est pas garantie"],
  ["accounts", "4. Comptes et admissibilité"],
  ["plans", "5. Forfait gratuit et Radar Pro"],
  ["alerts", "6. Courriels d’alerte d’offres"],
  ["submissions", "7. Contributions de la communauté"],
  ["restaurants", "8. Fiches de restaurants, revendications et portail des exploitants"],
  ["sponsored", "9. Placements commandités"],
  ["acceptable-use", "10. Utilisation acceptable"],
  ["moderation", "11. Modération et mesures d’application"],
  ["ip", "12. Propriété intellectuelle"],
  ["third-party", "13. Services et liens de tiers"],
  ["disclaimers", "14. Exclusions de garantie"],
  ["liability", "15. Limitation de responsabilité"],
  ["indemnity", "16. Indemnisation"],
  ["changes", "17. Modifications du service et des présentes conditions"],
  ["termination", "18. Résiliation"],
  ["general", "19. Dispositions générales"],
  ["contact", "20. Nous joindre"],
] as const;

export default function TermsFr() {
  return (
    <article lang="fr">
      <span className="kicker">DERNIÈRE MISE À JOUR : {legalDate(TERMS_LAST_UPDATED, "fr")}</span>
      <h1>Conditions d’utilisation</h1>
      <p className="lead">
        Les présentes conditions régissent votre utilisation de Radar. En consultant des offres, en
        créant un compte, en soumettant des renseignements ou en vous abonnant à Radar Pro, vous les
        acceptez. Si vous ne les acceptez pas, n’utilisez pas le service.
      </p>

      <TranslationNotice />

      <LegalToc sections={SECTIONS} label="Table des matières" />

      <h2 id="scope">1. Entre qui ces conditions sont conclues</h2>
      {/*
        Both names, deliberately. Ontario's Business Names Act s. 2(6) requires a corporation
        identifying itself to the public under a registered name to set out both the registered
        name and its own name in all contracts, invoices, negotiable instruments and orders
        involving goods or services — and this document (in either language) is a contract, agreed
        to by anyone who subscribes to Pro. Do not "clean up" the corporate name out of this
        paragraph; see the fuller note on the English version in page.tsx.
      */}
      <p>
        «&nbsp;Radar&nbsp;», «&nbsp;nous&nbsp;» et «&nbsp;notre&nbsp;» désignent 1000928808 Ontario
        Corp., faisant affaire sous le nom de Cedar Tech Solutions, une société ontarienne que l’on
        peut joindre à{" "}
        <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> ou par
        téléphone au <a href={`tel:${SUPPORT_PHONE.tel}`}>{SUPPORT_PHONE.display}</a>.
        «&nbsp;Vous&nbsp;» désigne la personne qui utilise le service. Radar est publié à
        radar.cheap. Notre{" "}
        <ChromeLink href="/privacy">Politique de confidentialité</ChromeLink> est intégrée par
        renvoi aux présentes conditions.
      </p>

      <h2 id="service">2. Ce que Radar fournit</h2>
      <p>
        Radar répertorie les promotions de restaurants — 5 à 7, spéciaux récurrents en semaine et
        offres d’une durée limitée — à partir de sources publiques et de suggestions de la
        communauté, et vous aide à trouver celles qui se trouvent près du code postal ou code ZIP
        que vous saisissez. Chaque fiche renvoie à la source dont elle provient et indique la date
        de sa dernière vérification ou, si elle n’a pas été vérifiée, la date de sa publication,
        afin que vous puissiez juger de son actualité.
      </p>
      <p>
        Radar est un service d’information. Nous ne sommes ni un restaurant, ni un système de
        réservation, ni un service de livraison, ni le mandataire d’un restaurant. Nous ne vendons
        pas de nourriture, ne fixons pas de prix et n’acceptons pas de commandes. Les marchés
        étiquetés «&nbsp;Limité&nbsp;» ou «&nbsp;En recherche&nbsp;» ont une couverture incomplète,
        et une étiquette de couverture ne constitue jamais une promesse que toutes les promotions
        locales ont été répertoriées.
      </p>

      <h2 id="accuracy">3. L’exactitude des offres n’est pas garantie</h2>
      <p>
        Les restaurants contrôlent eux-mêmes leurs prix, leurs heures, leurs règles d’admissibilité,
        leurs établissements participants et la tenue même d’une offre. Les offres changent et
        prennent fin sans préavis, et une promotion de chaîne peut ne pas être honorée dans toutes
        les succursales. Nous effectuons nos recherches à partir des sources indiquées en lien et
        publions les dates de vérification, mais nous ne pouvons pas garantir qu’une fiche est exacte
        au moment où vous la lisez.
      </p>
      <p>
        <strong>
          Confirmez chaque offre directement auprès du restaurant avant de commander ou de vous
          déplacer.
        </strong>{" "}
        Radar ne garantit ni économies ni disponibilité, et n’est pas responsable du refus d’un
        restaurant d’honorer une offre affichée.
      </p>

      <h2 id="accounts">4. Comptes et admissibilité</h2>
      <p>
        Vous pouvez consulter Radar sans compte. Enregistrer des offres, suivre des zones et
        recevoir des alertes nécessitent un compte. Les comptes sont créés et authentifiés par
        l’intermédiaire de notre fournisseur d’identité&nbsp;; vous êtes responsable de la sécurité
        de vos identifiants de connexion et des activités effectuées au moyen de votre compte.
      </p>
      <p>
        Vous devez avoir au moins 14 ans pour créer un compte, et avoir l’âge requis dans votre
        territoire de compétence pour accepter les présentes conditions. Radar ne s’adresse pas aux
        enfants. Une même personne ne peut pas tenir plusieurs comptes afin de contourner les limites
        du forfait gratuit ou une mesure d’application.
      </p>

      <h2 id="plans">5. Forfait gratuit et Radar Pro</h2>
      <p>
        Le forfait gratuit de Radar comprend la consultation et la recherche, les offres
        enregistrées, une zone suivie avec un rayon de recherche d’au plus 25 km, un courriel
        d’alerte hebdomadaire un jour donné à une heure d’envoi fixe, et vos 20 plus récentes
        entrées de l’historique des notifications. Radar Pro est un abonnement payant qui supprime ces limites —
        zones suivies illimitées, rayon d’au plus 50 km, alertes les jours et à l’heure de votre
        choix, historique de notifications plus long (vos 500 derniers envois, contre 20 avec le
        forfait gratuit) avec exportation CSV, et deux thèmes de couleur d’accent supplémentaires. La
        comparaison à jour se trouve sur notre{" "}
        <ChromeLink href="/pro">page des forfaits</ChromeLink>.
      </p>
      <p>
        Radar Pro peut être acheté à deux endroits, le site Web et l’application iOS Radar, et
        chacun est facturé par une entreprise différente. Peu importe celui que vous utilisez, le
        forfait et ses fonctionnalités sont les mêmes.
      </p>
      <p>
        <strong>Facturation sur le site Web.</strong> Un abonnement acheté sur radar.cheap est
        facturé par l’intermédiaire de Stripe, notre processeur de paiement. Le prix, la devise et
        la périodicité de facturation sont affichés sur la page de paiement de Stripe avant que vous
        confirmiez, et votre abonnement se renouvelle automatiquement selon cette périodicité jusqu’à
        ce que vous l’annuliez. Nous ne recevons ni ne conservons jamais votre numéro de carte
        complet&nbsp;; consultez la section{" "}
        <ChromeLink href="/privacy#payments">Paiements</ChromeLink> de notre Politique de
        confidentialité pour connaître les données de paiement que nous détenons.
      </p>
      <p>
        <strong>Achats dans l’application iOS.</strong> Un abonnement acheté dans l’application iOS
        Radar est vendu par l’intermédiaire de l’App Store d’Apple et est rattaché à votre identifiant
        Apple. Apple le facture au prix affiché dans l’App Store avant que vous confirmiez, lequel
        peut différer du prix sur le site Web, le renouvelle automatiquement à la fin de chaque
        période à moins que vous ne désactiviez le renouvellement automatique au moins 24 heures
        avant la fin de la période, et en gère la facturation selon ses propres conditions. Vous le
        gérez et l’annulez à partir de Réglages &rsaquo; votre nom &rsaquo; Abonnements sur votre
        appareil. Nous ne pouvons pas annuler ni rembourser un achat fait dans l’App Store à votre
        place&nbsp;: les remboursements s’y rapportant sont demandés à Apple à{" "}
        <a href="https://reportaproblem.apple.com" target="_blank" rel="noreferrer noopener">
          reportaproblem.apple.com
        </a>{" "}
        et décidés par Apple. La suppression de votre compte Radar n’annule pas un abonnement de
        l’App Store.
      </p>
      <p>
        <strong>Annulation.</strong> Un abonnement souscrit sur le site Web peut être annulé en tout
        temps à partir de la section Compte et confidentialité de votre tableau de bord, qui ouvre le
        portail de facturation de Stripe&nbsp;; un abonnement de l’App Store s’annule par
        l’intermédiaire d’Apple, comme il est décrit ci-dessus. L’annulation met fin au prochain
        renouvellement&nbsp;; les fonctionnalités Pro demeurent accessibles jusqu’à la fin de la
        période déjà payée, après quoi le compte revient au forfait gratuit. Les zones suivies que
        vous avez déjà ajoutées restent dans votre compte — la limite du forfait gratuit ne s’applique
        qu’à l’ajout de nouvelles zones.
      </p>
      <p>
        <strong>Remboursements.</strong> Les frais d’un abonnement souscrit sur le site Web ne sont
        pas remboursables, et nous n’accordons pas de remboursement partiel pour la période
        inutilisée d’un cycle de facturation, sauf dans les cas suivants&nbsp;: a) si vous annulez un
        forfait annuel dans les 15&nbsp;jours suivant son renouvellement, nous remboursons ce
        renouvellement en entier; b) si vous annulez dans les 14&nbsp;jours suivant le premier
        prélèvement à un nouveau prix plus élevé, nous remboursons la différence pour la période
        inutilisée; c) dans tout autre cas où la loi exige un remboursement. Si vous croyez
        avoir été facturé par erreur sur le site Web, écrivez à{" "}
        <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> et nous
        examinerons la situation. Les remboursements des achats faits dans l’App Store sont traités
        par Apple selon ses propres politiques.
      </p>
      <p>
        <strong>Modifications des prix et des fonctionnalités.</strong> Nous pouvons modifier le prix
        d’un abonnement ou le contenu d’un forfait. Une modification de prix ne prend effet, au plus
        tôt, qu’à votre prochain renouvellement, et nous vous en aviserons à l’avance afin que vous
        puissiez d’abord annuler. Des taxes peuvent s’ajouter lorsque la loi l’exige.
      </p>
      <p>
        <strong>Paiements refusés.</strong> Si un paiement de renouvellement échoue ou qu’un
        abonnement expire, nous pouvons faire revenir le compte au forfait gratuit jusqu’à ce que le
        paiement soit effectué.
      </p>

      <h2 id="alerts">6. Courriels d’alerte d’offres</h2>
      <p>
        La création d’un compte ne vous inscrit jamais à des courriels de marketing. Les alertes
        d’offres ne sont envoyées que dans le cadre d’un projet pilote contrôlé et exigent un
        consentement confirmé et consigné, une préférence activée, l’absence de suppression active et
        l’admissibilité au projet pilote — demander des alertes peut donc vous placer sur une liste
        d’attente plutôt que de déclencher les envois immédiatement. Chaque message comprend un moyen
        de cesser de recevoir les messages futurs, et vous pouvez désactiver les alertes en tout
        temps dans votre tableau de bord. Les messages transactionnels concernant votre compte, comme
        les confirmations de courriel, ne sont pas du marketing et sont envoyés quelles que soient vos
        préférences en matière de marketing.
      </p>

      <h2 id="submissions">7. Contributions de la communauté</h2>
      <p>
        Lorsque vous suggérez une offre, signalez une fiche inexacte ou envoyez des commentaires,
        vous accordez à Radar une licence non exclusive, mondiale et libre de redevances lui
        permettant d’examiner, de modifier, de publier, de traduire, d’afficher et de retirer ces
        renseignements dans le cadre du service. Vous conservez tous les droits que vous déteniez
        déjà sur ce que vous avez soumis.
      </p>
      <p>
        Vous confirmez que votre contribution est exacte au meilleur de votre connaissance et
        qu’elle ne porte atteinte aux droits de personne. Les contributions, les commentaires et les
        signalements d’offres inexactes peuvent être examinés par des administrateurs autorisés et
        sont conservés avec un historique d’audit opérationnel. Nous pouvons refuser, modifier ou
        retirer toute contribution, et nous n’avons aucune obligation d’en publier une.
      </p>

      <h2 id="restaurants">8. Fiches de restaurants, revendications et portail des exploitants</h2>
      <p>
        Une fiche peut être créée à partir de sources publiques sans la participation du restaurant,
        et la présence d’un restaurant sur Radar ne signifie pas qu’il est un partenaire ni qu’il a
        approuvé sa fiche. Une contribution d’un restaurant est examinée à titre d’information, et
        non acceptée comme preuve de propriété. La participation des chaînes est vérifiée par
        succursale lorsque c’est possible.
      </p>
      <p>
        Les revendications de restaurants, les analyses destinées aux exploitants et le portail des
        restaurants sont offerts sur invitation et peuvent exiger une vérification distincte et des
        conditions supplémentaires avant que l’accès soit accordé. Si vous utilisez le portail au nom
        d’une entreprise, vous confirmez être autorisé à agir pour cette entreprise et vous êtes
        responsable de l’exactitude de ce que vous y publiez. Un restaurant peut nous demander de
        corriger ou de retirer sa fiche en écrivant à{" "}
        <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a>.
      </p>

      <h2 id="sponsored">9. Placements commandités</h2>
      <p>
        Les placements payés ou promus portent l’étiquette «&nbsp;Commanditée&nbsp;». La commandite
        peut influer sur l’endroit où une fiche apparaît, mais elle ne dégage jamais le restaurant de
        sa responsabilité à l’égard de sa propre offre, et elle ne nous empêche pas d’examiner, de
        corriger ou de retirer des renseignements inexacts dans une fiche commanditée.
      </p>

      <h2 id="acceptable-use">10. Utilisation acceptable</h2>
      <p>Vous vous engagez à ne pas&nbsp;:</p>
      <ul>
        <li>soumettre des fiches, des signalements ou des commentaires faux, trompeurs ou indésirables&nbsp;;</li>
        <li>usurper l’identité d’une autre personne, d’une entreprise ou de Radar lui-même&nbsp;;</li>
        <li>
          moissonner, explorer ou télécharger en masse le service, ou utiliser des moyens automatisés
          pour y accéder au-delà d’une navigation ordinaire&nbsp;;
        </li>
        <li>
          contourner les limites de fréquence, les vérifications anti-robots, les limites des
          forfaits, l’authentification ou tout autre contrôle d’accès&nbsp;;
        </li>
        <li>sonder, perturber ou surcharger le service ou son infrastructure&nbsp;;</li>
        <li>
          téléverser du code malveillant ou du contenu illégal, harcelant, haineux ou contrefaisant&nbsp;;
        </li>
        <li>
          revendre, concéder en sous-licence ou redistribuer commercialement les données de Radar
          sans autorisation écrite&nbsp;; ou
        </li>
        <li>utiliser Radar pour enfreindre toute loi applicable.</li>
      </ul>

      <h2 id="moderation">11. Modération et mesures d’application</h2>
      <p>
        Nous pouvons examiner, modérer, modifier ou retirer du contenu, et nous pouvons donner un
        avertissement à un compte, en limiter la fréquence d’utilisation, le suspendre ou le
        résilier s’il contrevient aux présentes conditions, crée un risque juridique ou nuit à
        d’autres utilisateurs ou au service. Lorsque c’est possible et approprié, nous vous en
        indiquerons la raison, mais nous pouvons agir d’abord lorsque la situation l’exige.
      </p>

      <h2 id="ip">12. Propriété intellectuelle</h2>
      <p>
        Le nom, l’image de marque, le logiciel, la conception, la mise en page, la compilation des
        fiches et le contenu rédactionnel original de Radar appartiennent à l’exploitant du site et
        sont protégés par le droit de la propriété intellectuelle. Les noms, logos, menus et marques
        de commerce des restaurants appartiennent à leurs propriétaires respectifs et sont utilisés
        pour identifier les entreprises décrites. Une fiche n’implique aucune commandite, aucun
        appui ni aucune affiliation, à moins d’être expressément étiquetée comme telle.
      </p>
      <p>
        Le code source de Radar est également publié sous la licence publique générale GNU Affero,
        version 3, à <a href="https://github.com/Cedar-Tech-Solutions/Radar">github.com/Cedar-Tech-Solutions/Radar</a>.
        Cette licence vise uniquement le code de ce dépôt. Elle n’accorde aucun droit sur le nom, le
        logo ou l’image de marque de Radar, sur ses fiches ou leur compilation, ni sur son contenu
        rédactionnel, qui demeurent régis par la présente section.
      </p>
      <p>
        Vous recevez une licence limitée, personnelle, incessible et révocable vous permettant
        d’utiliser Radar à vos propres fins non commerciales. Si vous croyez qu’un contenu sur Radar
        porte atteinte à vos droits, écrivez à{" "}
        <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> en donnant
        suffisamment de détails pour identifier le contenu en cause et votre réclamation.
      </p>

      <h2 id="third-party">13. Services et liens de tiers</h2>
      <p>
        Radar contient des liens vers des sites Web de restaurants et d’autres sources externes, et
        fait appel à des fournisseurs tiers pour l’authentification, l’hébergement, la cartographie
        et le géocodage, les paiements, l’envoi de courriels et la traduction. Ces sites et services
        ont leurs propres conditions et pratiques en matière de confidentialité&nbsp;; nous ne les
        contrôlons pas et ne sommes pas responsables de leur contenu ni de leur conduite. La section{" "}
        <ChromeLink href="/privacy#providers">Fournisseurs de services</ChromeLink> de notre
        Politique de confidentialité énumère les fournisseurs auxquels nous faisons appel.
      </p>
      <p>
        Les descriptions d’offres peuvent être traduites automatiquement en français et en espagnol.
        Les traductions sont fournies pour plus de commodité, peuvent être imparfaites, et le texte
        source anglais prévaut en cas de divergence.
      </p>

      <h2 id="disclaimers">14. Exclusions de garantie</h2>
      <p>
        Le service est fourni «&nbsp;tel quel&nbsp;» et «&nbsp;selon sa disponibilité&nbsp;», sans
        garantie d’aucune sorte. Dans toute la mesure permise par la loi, nous déclinons toute
        garantie implicite, notamment de qualité marchande, d’adéquation à un usage particulier,
        d’absence de contrefaçon, d’exactitude et de fonctionnement ininterrompu ou exempt d’erreurs.
        Nous ne garantissons pas que les fiches sont exactes, complètes ou à jour, que les alertes
        seront envoyées à temps ou même envoyées, ni que les défauts seront corrigés. Certains
        territoires de compétence ne permettent pas l’exclusion de certaines garanties&nbsp;; il se
        peut donc que certaines parties de la présente section ne s’appliquent pas à vous.
      </p>

      <h2 id="liability">15. Limitation de responsabilité</h2>
      <p>
        Dans toute la mesure permise par la loi, Radar et l’exploitant du site ne sont pas
        responsables des dommages indirects, accessoires, spéciaux, consécutifs, exemplaires ou
        punitifs, ni des pertes de profits, des déplacements inutiles ou des pertes de données,
        découlant de votre utilisation du service ou d’une offre d’un restaurant, ou s’y rapportant,
        même si nous avons été avisés de cette possibilité.
      </p>
      <p>
        Dans toute la mesure permise par la loi, notre responsabilité totale cumulée pour toutes les
        réclamations relatives au service est limitée au plus élevé des montants suivants&nbsp;: le
        montant que vous nous avez payé au cours des douze mois précédant l’événement à l’origine de
        la réclamation, ou vingt dollars canadiens (20 $ CA). Rien dans les présentes conditions ne
        limite une responsabilité qui ne peut être limitée par la loi, notamment en cas de fraude ou
        de décès ou de préjudice corporel causé par la négligence.
      </p>
      <p>
        Si vous êtes un consommateur au Québec, les exclusions et limitations prévues aux sections 14
        et 15 ne s’appliquent pas dans la mesure où la Loi sur la protection du consommateur les
        interdit, et rien dans les présentes conditions ne limite notre responsabilité pour nos
        propres actes ou ceux de nos représentants. Les consommateurs des autres provinces,
        territoires et États conservent tous les droits auxquels ils ne peuvent renoncer en vertu de
        la loi sur la protection du consommateur qui s’applique chez eux.
      </p>

      <h2 id="indemnity">16. Indemnisation</h2>
      <p>
        Vous acceptez d’indemniser et de tenir à couvert l’exploitant du site à l’égard des
        réclamations, des dommages et des frais raisonnables découlant de votre manquement aux
        présentes conditions, de votre utilisation abusive du service ou du contenu que vous avez
        soumis — sauf dans la mesure où la réclamation résulte de notre propre conduite.
      </p>

      <h2 id="changes">17. Modifications du service et des présentes conditions</h2>
      <p>
        Nous pouvons ajouter, modifier ou abandonner des fonctionnalités, et nous pouvons mettre à
        jour les présentes conditions à mesure que le service évolue ou que la loi l’exige. La date
        de «&nbsp;dernière mise à jour&nbsp;» indiquée en haut de cette page identifie la version en
        vigueur. Si nous apportons une modification importante aux présentes conditions, nous vous
        en aviserons par courriel au moins 30&nbsp;jours avant son entrée en vigueur, en vous
        présentant la nouvelle clause, la clause qu’elle remplace et la date de son entrée en
        vigueur. Si vous refusez la modification, vous pouvez annuler votre abonnement avant cette
        date sans frais, et nous vous rembourserons toute période payée d’avance non utilisée. Nous
        n’utiliserons pas la présente section pour modifier la nature du service auquel vous vous
        êtes abonné.
      </p>

      <h2 id="termination">18. Résiliation</h2>
      <p>
        Vous pouvez cesser d’utiliser Radar en tout temps, annuler un abonnement (à partir de votre
        tableau de bord, ou par l’intermédiaire d’Apple pour un abonnement acheté dans l’application
        iOS) et demander la suppression des données de votre compte comme il est décrit dans la
        section{" "}
        <ChromeLink href="/privacy#rights">Vos droits et vos choix</ChromeLink>. Nous pouvons
        suspendre ou résilier l’accès afin de protéger les utilisateurs, de nous conformer à la loi
        ou de prévenir une utilisation abusive. Les dispositions qui, de par leur nature, devraient
        survivre à la résiliation — notamment la licence relative aux contributions, la propriété
        intellectuelle, les exclusions de garantie, la limitation de responsabilité,
        l’indemnisation et la présente section — continuent de s’appliquer par la suite.
      </p>

      <h2 id="general">19. Dispositions générales</h2>
      <p>
        Les présentes conditions, avec la Politique de confidentialité et toute condition
        supplémentaire que vous acceptez pour une fonctionnalité précise, constituent l’intégralité
        de l’entente entre vous et nous au sujet du service. Si une disposition est jugée
        inapplicable, les autres demeurent en vigueur et la partie inapplicable est appliquée de la
        façon la plus fidèle possible à son intention initiale. Le fait que nous n’appliquions pas
        une disposition ne constitue pas une renonciation à celle-ci. Vous ne pouvez pas céder les
        présentes conditions sans notre consentement&nbsp;; nous pouvons les céder dans le cadre
        d’une fusion, d’une acquisition ou d’une vente d’actifs. Les intertitres ne sont fournis
        que pour faciliter la lecture.
      </p>
      <p>
        Avant d’entamer un différend officiel, veuillez nous écrire à{" "}
        <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> afin que
        nous puissions tenter de le régler directement — la plupart des problèmes se règlent
        rapidement de cette façon.
      </p>
      <p>
        <strong>Droit applicable.</strong> Les présentes conditions sont régies par les lois de
        l’Ontario et les lois fédérales du Canada qui s’y appliquent. Si vous êtes un consommateur,
        cela ne vous prive pas de la protection des lois impératives sur la protection du
        consommateur de la province, du territoire ou de l’État où vous résidez, et vous pouvez
        intenter un recours devant les tribunaux de votre lieu de résidence. Rien dans les présentes
        conditions ne vous oblige à recourir à l’arbitrage ni ne vous prive de votre droit de
        participer à une action collective.
      </p>
      <p>
        <strong>Langue.</strong> Les présentes conditions sont disponibles en français et en anglais,
        et vous pouvez les consulter et les accepter dans l’une ou l’autre langue. Si vous résidez au
        Québec et choisissez la version anglaise, vous le faites à votre demande expresse.
      </p>

      <h2 id="contact">20. Nous joindre</h2>
      <p>
        Les questions sur les présentes conditions, les corrections de fiches, les problèmes de
        compte, les questions relatives à la confidentialité et les demandes concernant les données
        doivent toutes être adressées à{" "}
        <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a>.
      </p>
    </article>
  );
}
