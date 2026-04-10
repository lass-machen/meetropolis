import { useTranslation } from 'react-i18next';
import { LegalLayout } from './LegalLayout';

interface PrivacyPolicyPageProps {
  onBack: () => void;
  registrationEnabled?: boolean;
}

export function PrivacyPolicyPage({ onBack, registrationEnabled }: PrivacyPolicyPageProps) {
  const { t } = useTranslation('public');
  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };

  const sections = [
    {
      id: 'ueberblick',
      title: '1. Datenschutz auf einen Blick',
      content: (
        <div>
          <h3>Allgemeine Hinweise</h3>
          <p>
            Die folgenden Hinweise geben einen einfachen \u00dcberblick dar\u00fcber, was mit Ihren
            personenbezogenen Daten passiert, wenn Sie diese Website besuchen. Personenbezogene
            Daten sind alle Daten, mit denen Sie pers\u00f6nlich identifiziert werden k\u00f6nnen.
            Ausf\u00fchrliche Informationen zum Thema Datenschutz entnehmen Sie unserer unter
            diesem Text aufgef\u00fchrten Datenschutzerkl\u00e4rung.
          </p>

          <h3>Datenerfassung auf dieser Website</h3>

          <h4>Wer ist verantwortlich f\u00fcr die Datenerfassung auf dieser Website?</h4>
          <p>
            Die Datenverarbeitung auf dieser Website erfolgt durch den Websitebetreiber. Dessen
            Kontaktdaten k\u00f6nnen Sie dem Abschnitt \u201eHinweis zur Verantwortlichen Stelle\u201c in
            dieser Datenschutzerkl\u00e4rung entnehmen.
          </p>

          <h4>Wie erfassen wir Ihre Daten?</h4>
          <p>
            Ihre Daten werden zum einen dadurch erhoben, dass Sie uns diese mitteilen. Hierbei
            kann es sich z.&nbsp;B. um Daten handeln, die Sie in ein Kontaktformular eingeben.
          </p>
          <p>
            Andere Daten werden automatisch oder nach Ihrer Einwilligung beim Besuch der Website
            durch unsere IT-Systeme erfasst. Das sind vor allem technische Daten (z.&nbsp;B.
            Internetbrowser, Betriebssystem oder Uhrzeit des Seitenaufrufs). Die Erfassung dieser
            Daten erfolgt automatisch, sobald Sie diese Website betreten.
          </p>

          <h4>Wof\u00fcr nutzen wir Ihre Daten?</h4>
          <p>
            Ein Teil der Daten wird erhoben, um eine fehlerfreie Bereitstellung der Website zu
            gew\u00e4hrleisten. Andere Daten k\u00f6nnen zur Analyse Ihres Nutzerverhaltens verwendet
            werden. Sofern \u00fcber die Website Vertr\u00e4ge geschlossen oder angebahnt werden k\u00f6nnen,
            werden die \u00fcbermittelten Daten auch f\u00fcr Vertragsangebote, Bestellungen oder sonstige
            Auftragsanfragen verarbeitet.
          </p>

          <h4>Welche Rechte haben Sie bez\u00fcglich Ihrer Daten?</h4>
          <p>
            Sie haben jederzeit das Recht, unentgeltlich Auskunft \u00fcber Herkunft, Empf\u00e4nger und
            Zweck Ihrer gespeicherten personenbezogenen Daten zu erhalten. Sie haben au\u00dferdem
            ein Recht, die Berichtigung oder L\u00f6schung dieser Daten zu verlangen. Wenn Sie eine
            Einwilligung zur Datenverarbeitung erteilt haben, k\u00f6nnen Sie diese Einwilligung
            jederzeit f\u00fcr die Zukunft widerrufen. Au\u00dferdem haben Sie das Recht, unter bestimmten
            Umst\u00e4nden die Einschr\u00e4nkung der Verarbeitung Ihrer personenbezogenen Daten zu
            verlangen. Des Weiteren steht Ihnen ein Beschwerderecht bei der zust\u00e4ndigen
            Aufsichtsbeh\u00f6rde zu.
          </p>
          <p>
            Hierzu sowie zu weiteren Fragen zum Thema Datenschutz k\u00f6nnen Sie sich jederzeit an
            uns wenden.
          </p>
        </div>
      ),
    },
    {
      id: 'hosting',
      title: '2. Hosting',
      content: (
        <div>
          <p>Wir hosten die Inhalte unserer Website bei folgendem Anbieter:</p>

          <h3>Externes Hosting</h3>
          <p>
            Diese Website wird extern gehostet. Die personenbezogenen Daten, die auf dieser
            Website erfasst werden, werden auf den Servern des Hosters / der Hoster gespeichert.
            Hierbei kann es sich v.&nbsp;a. um IP-Adressen, Kontaktanfragen, Meta- und
            Kommunikationsdaten, Vertragsdaten, Kontaktdaten, Namen, Websitezugriffe und sonstige
            Daten, die \u00fcber eine Website generiert werden, handeln.
          </p>
          <p>
            Das externe Hosting erfolgt zum Zwecke der Vertragserf\u00fcllung gegen\u00fcber unseren
            potenziellen und bestehenden Kunden (Art. 6 Abs. 1 lit. b DSGVO) und im Interesse
            einer sicheren, schnellen und effizienten Bereitstellung unseres Online-Angebots
            durch einen professionellen Anbieter (Art. 6 Abs. 1 lit. f DSGVO). Sofern eine
            entsprechende Einwilligung abgefragt wurde, erfolgt die Verarbeitung ausschlie\u00dflich
            auf Grundlage von Art. 6 Abs. 1 lit. a DSGVO und \u00a7 25 Abs. 1 TDDDG, soweit die
            Einwilligung die Speicherung von Cookies oder den Zugriff auf Informationen im
            Endger\u00e4t des Nutzers (z.&nbsp;B. Device-Fingerprinting) im Sinne des TDDDG umfasst.
            Die Einwilligung ist jederzeit widerrufbar.
          </p>
          <p>
            Unser(e) Hoster wird bzw. werden Ihre Daten nur insoweit verarbeiten, wie dies zur
            Erf\u00fcllung seiner Leistungspflichten erforderlich ist und unsere Weisungen in Bezug
            auf diese Daten befolgen.
          </p>
          <p>Wir setzen folgende(n) Hoster ein:</p>
          <p>
            netcup GmbH<br />
            Emmy-Noether-Stra\u00dfe 10<br />
            D-76131 Karlsruhe
          </p>

          <h4>Auftragsverarbeitung</h4>
          <p>
            Wir haben einen Vertrag \u00fcber Auftragsverarbeitung (AVV) zur Nutzung des oben
            genannten Dienstes geschlossen. Hierbei handelt es sich um einen
            datenschutzrechtlich vorgeschriebenen Vertrag, der gew\u00e4hrleistet, dass dieser die
            personenbezogenen Daten unserer Websitebesucher nur nach unseren Weisungen und unter
            Einhaltung der DSGVO verarbeitet.
          </p>
        </div>
      ),
    },
    {
      id: 'allgemein',
      title: '3. Allgemeine Hinweise und Pflichtinformationen',
      content: (
        <div>
          <h3>Datenschutz</h3>
          <p>
            Die Betreiber dieser Seiten nehmen den Schutz Ihrer pers\u00f6nlichen Daten sehr ernst.
            Wir behandeln Ihre personenbezogenen Daten vertraulich und entsprechend den
            gesetzlichen Datenschutzvorschriften sowie dieser Datenschutzerkl\u00e4rung.
          </p>
          <p>
            Wenn Sie diese Website benutzen, werden verschiedene personenbezogene Daten erhoben.
            Personenbezogene Daten sind Daten, mit denen Sie pers\u00f6nlich identifiziert werden
            k\u00f6nnen. Die vorliegende Datenschutzerkl\u00e4rung erl\u00e4utert, welche Daten wir erheben
            und wof\u00fcr wir sie nutzen. Sie erl\u00e4utert auch, wie und zu welchem Zweck das
            geschieht.
          </p>
          <p>
            Wir weisen darauf hin, dass die Daten\u00fcbertragung im Internet (z.&nbsp;B. bei der
            Kommunikation per E-Mail) Sicherheitsl\u00fccken aufweisen kann. Ein l\u00fcckenloser Schutz
            der Daten vor dem Zugriff durch Dritte ist nicht m\u00f6glich.
          </p>

          <h3>Hinweis zur verantwortlichen Stelle</h3>
          <p>
            Die verantwortliche Stelle f\u00fcr die Datenverarbeitung auf dieser Website ist:
          </p>
          <p>
            Tiamat UG (haftungsbeschr\u00e4nkt)<br />
            An der Strusbek 12<br />
            D-22926 Ahrensburg
          </p>
          <p>
            Telefon: [Telefonnummer der verantwortlichen Stelle]<br />
            E-Mail:{' '}
            <a href="mailto:mail@tiamat-labs.com">mail@tiamat-labs.com</a>
          </p>
          <p>
            Verantwortliche Stelle ist die nat\u00fcrliche oder juristische Person, die allein oder
            gemeinsam mit anderen \u00fcber die Zwecke und Mittel der Verarbeitung von
            personenbezogenen Daten (z.&nbsp;B. Namen, E-Mail-Adressen o.&nbsp;\u00c4.) entscheidet.
          </p>

          <h3>Speicherdauer</h3>
          <p>
            Soweit innerhalb dieser Datenschutzerkl\u00e4rung keine speziellere Speicherdauer genannt
            wurde, verbleiben Ihre personenbezogenen Daten bei uns, bis der Zweck f\u00fcr die
            Datenverarbeitung entf\u00e4llt. Wenn Sie ein berechtigtes L\u00f6schersuchen geltend machen
            oder eine Einwilligung zur Datenverarbeitung widerrufen, werden Ihre Daten gel\u00f6scht,
            sofern wir keine anderen rechtlich zul\u00e4ssigen Gr\u00fcnde f\u00fcr die Speicherung Ihrer
            personenbezogenen Daten haben (z.&nbsp;B. steuer- oder handelsrechtliche
            Aufbewahrungsfristen); im letztgenannten Fall erfolgt die L\u00f6schung nach Fortfall
            dieser Gr\u00fcnde.
          </p>

          <h3>Allgemeine Hinweise zu den Rechtsgrundlagen der Datenverarbeitung auf dieser Website</h3>
          <p>
            Sofern Sie in die Datenverarbeitung eingewilligt haben, verarbeiten wir Ihre
            personenbezogenen Daten auf Grundlage von Art. 6 Abs. 1 lit. a DSGVO bzw. Art. 9
            Abs. 2 lit. a DSGVO, sofern besondere Datenkategorien nach Art. 9 Abs. 1 DSGVO
            verarbeitet werden. Im Falle einer ausdr\u00fccklichen Einwilligung in die \u00dcbertragung
            personenbezogener Daten in Drittstaaten erfolgt die Datenverarbeitung au\u00dferdem auf
            Grundlage von Art. 49 Abs. 1 lit. a DSGVO. Sofern Sie in die Speicherung von Cookies
            oder in den Zugriff auf Informationen in Ihr Endger\u00e4t (z.&nbsp;B. via
            Device-Fingerprinting) eingewilligt haben, erfolgt die Datenverarbeitung zus\u00e4tzlich
            auf Grundlage von \u00a7 25 Abs. 1 TDDDG. Die Einwilligung ist jederzeit widerrufbar.
            Sind Ihre Daten zur Vertragserf\u00fcllung oder zur Durchf\u00fchrung vorvertraglicher
            Ma\u00dfnahmen erforderlich, verarbeiten wir Ihre Daten auf Grundlage des Art. 6 Abs. 1
            lit. b DSGVO. Des Weiteren verarbeiten wir Ihre Daten, sofern diese zur Erf\u00fcllung
            einer rechtlichen Verpflichtung erforderlich sind auf Grundlage von Art. 6 Abs. 1
            lit. c DSGVO. Die Datenverarbeitung kann ferner auf Grundlage unseres berechtigten
            Interesses nach Art. 6 Abs. 1 lit. f DSGVO erfolgen. \u00dcber die jeweils im Einzelfall
            einschl\u00e4gigen Rechtsgrundlagen wird in den folgenden Abs\u00e4tzen dieser
            Datenschutzerkl\u00e4rung informiert.
          </p>

          <h3>Empf\u00e4nger von personenbezogenen Daten</h3>
          <p>
            Im Rahmen unserer Gesch\u00e4ftst\u00e4tigkeit arbeiten wir mit verschiedenen externen Stellen
            zusammen. Dabei ist teilweise auch eine \u00dcbermittlung von personenbezogenen Daten an
            diese externen Stellen erforderlich. Wir geben personenbezogene Daten nur dann an
            externe Stellen weiter, wenn dies im Rahmen einer Vertragserf\u00fcllung erforderlich ist,
            wenn wir gesetzlich hierzu verpflichtet sind (z.&nbsp;B. Weitergabe von Daten an
            Steuerbeh\u00f6rden), wenn wir ein berechtigtes Interesse nach Art. 6 Abs. 1 lit. f DSGVO
            an der Weitergabe haben oder wenn eine sonstige Rechtsgrundlage die Datenweitergabe
            erlaubt. Beim Einsatz von Auftragsverarbeitern geben wir personenbezogene Daten
            unserer Kunden nur auf Grundlage eines g\u00fcltigen Vertrags \u00fcber Auftragsverarbeitung
            weiter. Im Falle einer gemeinsamen Verarbeitung wird ein Vertrag \u00fcber gemeinsame
            Verarbeitung geschlossen.
          </p>

          <h3>Widerruf Ihrer Einwilligung zur Datenverarbeitung</h3>
          <p>
            Viele Datenverarbeitungsvorg\u00e4nge sind nur mit Ihrer ausdr\u00fccklichen Einwilligung
            m\u00f6glich. Sie k\u00f6nnen eine bereits erteilte Einwilligung jederzeit widerrufen. Die
            Rechtm\u00e4\u00dfigkeit der bis zum Widerruf erfolgten Datenverarbeitung bleibt vom Widerruf
            unber\u00fchrt.
          </p>

          <h3>Widerspruchsrecht gegen die Datenerhebung in besonderen F\u00e4llen sowie gegen Direktwerbung (Art. 21 DSGVO)</h3>
          <p>
            <strong>
              WENN DIE DATENVERARBEITUNG AUF GRUNDLAGE VON ART. 6 ABS. 1 LIT. E ODER F DSGVO
              ERFOLGT, HABEN SIE JEDERZEIT DAS RECHT, AUS GR\u00dcNDEN, DIE SICH AUS IHRER BESONDEREN
              SITUATION ERGEBEN, GEGEN DIE VERARBEITUNG IHRER PERSONENBEZOGENEN DATEN WIDERSPRUCH
              EINZULEGEN; DIES GILT AUCH F\u00dcR EIN AUF DIESE BESTIMMUNGEN GEST\u00dcTZTES PROFILING. DIE
              JEWEILIGE RECHTSGRUNDLAGE, AUF DENEN EINE VERARBEITUNG BERUHT, ENTNEHMEN SIE DIESER
              DATENSCHUTZERKL\u00c4RUNG. WENN SIE WIDERSPRUCH EINLEGEN, WERDEN WIR IHRE BETROFFENEN
              PERSONENBEZOGENEN DATEN NICHT MEHR VERARBEITEN, ES SEI DENN, WIR K\u00d6NNEN ZWINGENDE
              SCHUTZW\u00dcRDIGE GR\u00dcNDE F\u00dcR DIE VERARBEITUNG NACHWEISEN, DIE IHRE INTERESSEN, RECHTE
              UND FREIHEITEN \u00dcBERWIEGEN ODER DIE VERARBEITUNG DIENT DER GELTENDMACHUNG, AUS\u00dcBUNG
              ODER VERTEIDIGUNG VON RECHTSANSPR\u00dcCHEN (WIDERSPRUCH NACH ART. 21 ABS. 1 DSGVO).
            </strong>
          </p>
          <p>
            <strong>
              WERDEN IHRE PERSONENBEZOGENEN DATEN VERARBEITET, UM DIREKTWERBUNG ZU BETREIBEN, SO
              HABEN SIE DAS RECHT, JEDERZEIT WIDERSPRUCH GEGEN DIE VERARBEITUNG SIE BETREFFENDER
              PERSONENBEZOGENER DATEN ZUM ZWECKE DERARTIGER WERBUNG EINZULEGEN; DIES GILT AUCH
              F\u00dcR DAS PROFILING, SOWEIT ES MIT SOLCHER DIREKTWERBUNG IN VERBINDUNG STEHT. WENN SIE
              WIDERSPRECHEN, WERDEN IHRE PERSONENBEZOGENEN DATEN ANSCHLIESSEND NICHT MEHR ZUM
              ZWECKE DER DIREKTWERBUNG VERWENDET (WIDERSPRUCH NACH ART. 21 ABS. 2 DSGVO).
            </strong>
          </p>

          <h3>Beschwerderecht bei der zust\u00e4ndigen Aufsichtsbeh\u00f6rde</h3>
          <p>
            Im Falle von Verst\u00f6\u00dfen gegen die DSGVO steht den Betroffenen ein Beschwerderecht bei
            einer Aufsichtsbeh\u00f6rde, insbesondere in dem Mitgliedstaat ihres gew\u00f6hnlichen
            Aufenthalts, ihres Arbeitsplatzes oder des Orts des mutma\u00dflichen Versto\u00dfes zu. Das
            Beschwerderecht besteht unbeschadet anderweitiger verwaltungsrechtlicher oder
            gerichtlicher Rechtsbehelfe.
          </p>

          <h3>Recht auf Daten\u00fcbertragbarkeit</h3>
          <p>
            Sie haben das Recht, Daten, die wir auf Grundlage Ihrer Einwilligung oder in
            Erf\u00fcllung eines Vertrags automatisiert verarbeiten, an sich oder an einen Dritten in
            einem g\u00e4ngigen, maschinenlesbaren Format aush\u00e4ndigen zu lassen. Sofern Sie die
            direkte \u00dcbertragung der Daten an einen anderen Verantwortlichen verlangen, erfolgt
            dies nur, soweit es technisch machbar ist.
          </p>

          <h3>Auskunft, Berichtigung und L\u00f6schung</h3>
          <p>
            Sie haben im Rahmen der geltenden gesetzlichen Bestimmungen jederzeit das Recht auf
            unentgeltliche Auskunft \u00fcber Ihre gespeicherten personenbezogenen Daten, deren
            Herkunft und Empf\u00e4nger und den Zweck der Datenverarbeitung und ggf. ein Recht auf
            Berichtigung oder L\u00f6schung dieser Daten. Hierzu sowie zu weiteren Fragen zum Thema
            personenbezogene Daten k\u00f6nnen Sie sich jederzeit an uns wenden.
          </p>

          <h3>Recht auf Einschr\u00e4nkung der Verarbeitung</h3>
          <p>
            Sie haben das Recht, die Einschr\u00e4nkung der Verarbeitung Ihrer personenbezogenen
            Daten zu verlangen. Hierzu k\u00f6nnen Sie sich jederzeit an uns wenden. Das Recht auf
            Einschr\u00e4nkung der Verarbeitung besteht in folgenden F\u00e4llen:
          </p>
          <ul>
            <li>
              Wenn Sie die Richtigkeit Ihrer bei uns gespeicherten personenbezogenen Daten
              bestreiten, ben\u00f6tigen wir in der Regel Zeit, um dies zu \u00fcberpr\u00fcfen. F\u00fcr die Dauer
              der Pr\u00fcfung haben Sie das Recht, die Einschr\u00e4nkung der Verarbeitung Ihrer
              personenbezogenen Daten zu verlangen.
            </li>
            <li>
              Wenn die Verarbeitung Ihrer personenbezogenen Daten unrechtm\u00e4\u00dfig geschah/geschieht,
              k\u00f6nnen Sie statt der L\u00f6schung die Einschr\u00e4nkung der Datenverarbeitung verlangen.
            </li>
            <li>
              Wenn wir Ihre personenbezogenen Daten nicht mehr ben\u00f6tigen, Sie sie jedoch zur
              Aus\u00fcbung, Verteidigung oder Geltendmachung von Rechtsanspr\u00fcchen ben\u00f6tigen, haben
              Sie das Recht, statt der L\u00f6schung die Einschr\u00e4nkung der Verarbeitung Ihrer
              personenbezogenen Daten zu verlangen.
            </li>
            <li>
              Wenn Sie einen Widerspruch nach Art. 21 Abs. 1 DSGVO eingelegt haben, muss eine
              Abw\u00e4gung zwischen Ihren und unseren Interessen vorgenommen werden. Solange noch
              nicht feststeht, wessen Interessen \u00fcberwiegen, haben Sie das Recht, die
              Einschr\u00e4nkung der Verarbeitung Ihrer personenbezogenen Daten zu verlangen.
            </li>
          </ul>
          <p>
            Wenn Sie die Verarbeitung Ihrer personenbezogenen Daten eingeschr\u00e4nkt haben, d\u00fcrfen
            diese Daten \u2013 von ihrer Speicherung abgesehen \u2013 nur mit Ihrer Einwilligung oder zur
            Geltendmachung, Aus\u00fcbung oder Verteidigung von Rechtsanspr\u00fcchen oder zum Schutz der
            Rechte einer anderen nat\u00fcrlichen oder juristischen Person oder aus Gr\u00fcnden eines
            wichtigen \u00f6ffentlichen Interesses der Europ\u00e4ischen Union oder eines Mitgliedstaats
            verarbeitet werden.
          </p>

          <h3>SSL- bzw. TLS-Verschl\u00fcsselung</h3>
          <p>
            Diese Seite nutzt aus Sicherheitsgr\u00fcnden und zum Schutz der \u00dcbertragung
            vertraulicher Inhalte, wie zum Beispiel Bestellungen oder Anfragen, die Sie an uns
            als Seitenbetreiber senden, eine SSL- bzw. TLS-Verschl\u00fcsselung. Eine verschl\u00fcsselte
            Verbindung erkennen Sie daran, dass die Adresszeile des Browsers von \u201ehttp://\u201c auf
            \u201ehttps://\u201c wechselt und an dem Schloss-Symbol in Ihrer Browserzeile.
          </p>
          <p>
            Wenn die SSL- bzw. TLS-Verschl\u00fcsselung aktiviert ist, k\u00f6nnen die Daten, die Sie an
            uns \u00fcbermitteln, nicht von Dritten mitgelesen werden.
          </p>

          <h3>Verschl\u00fcsselter Zahlungsverkehr auf dieser Website</h3>
          <p>
            Besteht nach dem Abschluss eines kostenpflichtigen Vertrags eine Verpflichtung, uns
            Ihre Zahlungsdaten (z.&nbsp;B. Kontonummer bei Einzugserm\u00e4chtigung) zu \u00fcbermitteln,
            werden diese Daten zur Zahlungsabwicklung ben\u00f6tigt.
          </p>
          <p>
            Der Zahlungsverkehr \u00fcber die g\u00e4ngigen Zahlungsmittel (Visa/MasterCard,
            Lastschriftverfahren) erfolgt ausschlie\u00dflich \u00fcber eine verschl\u00fcsselte SSL- bzw.
            TLS-Verbindung. Eine verschl\u00fcsselte Verbindung erkennen Sie daran, dass die
            Adresszeile des Browsers von \u201ehttp://\u201c auf \u201ehttps://\u201c wechselt und an dem
            Schloss-Symbol in Ihrer Browserzeile.
          </p>
          <p>
            Bei verschl\u00fcsselter Kommunikation k\u00f6nnen Ihre Zahlungsdaten, die Sie an uns
            \u00fcbermitteln, nicht von Dritten mitgelesen werden.
          </p>
        </div>
      ),
    },
    {
      id: 'datenerfassung',
      title: '4. Datenerfassung auf dieser Website',
      content: (
        <div>
          <h3>Cookies</h3>
          <p>
            Unsere Internetseiten verwenden so genannte \u201eCookies\u201c. Cookies sind kleine
            Datenpakete und richten auf Ihrem Endger\u00e4t keinen Schaden an. Sie werden entweder
            vor\u00fcbergehend f\u00fcr die Dauer einer Sitzung (Session-Cookies) oder dauerhaft (permanente
            Cookies) auf Ihrem Endger\u00e4t gespeichert. Session-Cookies werden nach Ende Ihres
            Besuchs automatisch gel\u00f6scht. Permanente Cookies bleiben auf Ihrem Endger\u00e4t
            gespeichert, bis Sie diese selbst l\u00f6schen oder eine automatische L\u00f6schung durch
            Ihren Webbrowser erfolgt.
          </p>
          <p>
            Cookies k\u00f6nnen von uns (First-Party-Cookies) oder von Drittunternehmen stammen (sog.
            Third-Party-Cookies). Third-Party-Cookies erm\u00f6glichen die Einbindung bestimmter
            Dienstleistungen von Drittunternehmen innerhalb von Webseiten (z.&nbsp;B. Cookies zur
            Abwicklung von Zahlungsdienstleistungen).
          </p>
          <p>
            Cookies haben verschiedene Funktionen. Zahlreiche Cookies sind technisch notwendig,
            da bestimmte Webseitenfunktionen ohne diese nicht funktionieren w\u00fcrden (z.&nbsp;B. die
            Warenkorbfunktion oder die Anzeige von Videos). Andere Cookies k\u00f6nnen zur Auswertung
            des Nutzerverhaltens oder zu Werbezwecken verwendet werden.
          </p>
          <p>
            Cookies, die zur Durchf\u00fchrung des elektronischen Kommunikationsvorgangs, zur
            Bereitstellung bestimmter, von Ihnen erw\u00fcnschter Funktionen (z.&nbsp;B. f\u00fcr die
            Warenkorbfunktion) oder zur Optimierung der Website (z.&nbsp;B. Cookies zur Messung des
            Webpublikums) erforderlich sind (notwendige Cookies), werden auf Grundlage von Art. 6
            Abs. 1 lit. f DSGVO gespeichert, sofern keine andere Rechtsgrundlage angegeben wird.
            Der Websitebetreiber hat ein berechtigtes Interesse an der Speicherung von
            notwendigen Cookies zur technisch fehlerfreien und optimierten Bereitstellung seiner
            Dienste. Sofern eine Einwilligung zur Speicherung von Cookies und vergleichbaren
            Wiedererkennungstechnologien abgefragt wurde, erfolgt die Verarbeitung ausschlie\u00dflich
            auf Grundlage dieser Einwilligung (Art. 6 Abs. 1 lit. a DSGVO und \u00a7 25 Abs. 1
            TDDDG); die Einwilligung ist jederzeit widerrufbar.
          </p>
          <p>
            Sie k\u00f6nnen Ihren Browser so einstellen, dass Sie \u00fcber das Setzen von Cookies
            informiert werden und Cookies nur im Einzelfall erlauben, die Annahme von Cookies
            f\u00fcr bestimmte F\u00e4lle oder generell ausschlie\u00dfen sowie das automatische L\u00f6schen der
            Cookies beim Schlie\u00dfen des Browsers aktivieren. Bei der Deaktivierung von Cookies
            kann die Funktionalit\u00e4t dieser Website eingeschr\u00e4nkt sein.
          </p>
          <p>
            Sofern weitere Cookies und Dienste auf dieser Website eingesetzt werden, k\u00f6nnen Sie
            dies dieser Datenschutzerkl\u00e4rung entnehmen.
          </p>
        </div>
      ),
    },
    {
      id: 'ecommerce',
      title: '5. eCommerce und Zahlungsanbieter',
      content: (
        <div>
          <h3>Verarbeiten von Kunden- und Vertragsdaten</h3>
          <p>
            Wir erheben, verarbeiten und nutzen personenbezogene Kunden- und Vertragsdaten zur
            Begr\u00fcndung, inhaltlichen Ausgestaltung und \u00c4nderung unserer Vertragsbeziehungen.
            Personenbezogene Daten \u00fcber die Inanspruchnahme dieser Website (Nutzungsdaten)
            erheben, verarbeiten und nutzen wir nur, soweit dies erforderlich ist, um dem Nutzer
            die Inanspruchnahme des Dienstes zu erm\u00f6glichen oder abzurechnen. Rechtsgrundlage
            hierf\u00fcr ist Art. 6 Abs. 1 lit. b DSGVO.
          </p>
          <p>
            Die erhobenen Kundendaten werden nach Abschluss des Auftrags oder Beendigung der
            Gesch\u00e4ftsbeziehung und Ablauf der ggf. bestehenden gesetzlichen Aufbewahrungsfristen
            gel\u00f6scht. Gesetzliche Aufbewahrungsfristen bleiben unber\u00fchrt.
          </p>

          <h3>Daten\u00fcbermittlung bei Vertragsschluss f\u00fcr Dienstleistungen und digitale Inhalte</h3>
          <p>
            Wir \u00fcbermitteln personenbezogene Daten an Dritte nur dann, wenn dies im Rahmen der
            Vertragsabwicklung notwendig ist, etwa an das mit der Zahlungsabwicklung beauftragte
            Kreditinstitut.
          </p>
          <p>
            Eine weitergehende \u00dcbermittlung der Daten erfolgt nicht bzw. nur dann, wenn Sie der
            \u00dcbermittlung ausdr\u00fccklich zugestimmt haben. Eine Weitergabe Ihrer Daten an Dritte
            ohne ausdr\u00fcckliche Einwilligung, etwa zu Zwecken der Werbung, erfolgt nicht.
          </p>
          <p>
            Grundlage f\u00fcr die Datenverarbeitung ist Art. 6 Abs. 1 lit. b DSGVO, der die
            Verarbeitung von Daten zur Erf\u00fcllung eines Vertrags oder vorvertraglicher Ma\u00dfnahmen
            gestattet.
          </p>

          <h3>Zahlungsdienste</h3>
          <p>
            Wir binden Zahlungsdienste von Drittunternehmen auf unserer Website ein. Wenn Sie
            einen Kauf bei uns t\u00e4tigen, werden Ihre Zahlungsdaten (z.&nbsp;B. Name,
            Zahlungssumme, Kontoverbindung, Kreditkartennummer) vom Zahlungsdienstleister zum
            Zwecke der Zahlungsabwicklung verarbeitet. F\u00fcr diese Transaktionen gelten die
            jeweiligen Vertrags- und Datenschutzbestimmungen der jeweiligen Anbieter. Der Einsatz
            der Zahlungsdienstleister erfolgt auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO
            (Vertragsabwicklung) sowie im Interesse eines m\u00f6glichst reibungslosen, komfortablen
            und sicheren Zahlungsvorgangs (Art. 6 Abs. 1 lit. f DSGVO). Soweit f\u00fcr bestimmte
            Handlungen Ihre Einwilligung abgefragt wird, ist Art. 6 Abs. 1 lit. a DSGVO
            Rechtsgrundlage der Datenverarbeitung; Einwilligungen sind jederzeit f\u00fcr die Zukunft
            widerrufbar.
          </p>
          <p>
            Folgende Zahlungsdienste / Zahlungsdienstleister setzen wir im Rahmen dieser
            Website ein:
          </p>

          <h4>Stripe</h4>
          <p>
            Anbieter f\u00fcr Kunden innerhalb der EU ist die Stripe Payments Europe, Ltd.,1 Grand
            Canal Street Lower, Grand Canal Dock, Dublin, Irland (im Folgenden \u201eStripe\u201c).
          </p>
          <p>
            Die Daten\u00fcbertragung in die USA wird auf die Standardvertragsklauseln der
            EU-Kommission gest\u00fctzt. Details finden Sie hier:{' '}
            <a
              href="https://stripe.com/de/privacy"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://stripe.com/de/privacy
            </a>{' '}
            und{' '}
            <a
              href="https://stripe.com/de/guides/general-data-protection-regulation"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://stripe.com/de/guides/general-data-protection-regulation
            </a>
            .
          </p>
          <p>
            Details hierzu k\u00f6nnen Sie in der Datenschutzerkl\u00e4rung von Stripe unter folgendem
            Link nachlesen:{' '}
            <a
              href="https://stripe.com/de/privacy"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://stripe.com/de/privacy
            </a>
            .
          </p>
        </div>
      ),
    },
  ];

  return (
    <LegalLayout
      title={t('legal.privacyTitle')}
      subtitle={t('legal.privacySubtitle')}
      breadcrumbLabel={t('legal.privacyTitle')}
      lastUpdated="10. April 2026"
      sections={sections}
      onBack={onBack}
      navigate={navigate}
      {...(registrationEnabled !== undefined && { registrationEnabled })}
    />
  );
}
