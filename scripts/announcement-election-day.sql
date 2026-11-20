-- Election-day do's and don'ts for booth agents, sent to every constituency.
-- Scheduled on the server to run at 05:00 IST on polling day (01-11-2026).
-- Agents see it over the app's home screen and tick that they have read it.
--
--   bash scripts/prod-sql.sh run scripts/announcement-election-day.sql
\set ON_ERROR_STOP on
BEGIN;
-- Prisma reads these columns as UTC; the server's clock is IST.
UPDATE assemblies SET announcement_enabled = true,
  announcement_title = 'పోలింగ్ రోజు సూచనలు',
  announcement_body = $msg$చేయవలసినవి:
- ఎన్నికల అధికారుల సూచనల ప్రకారం అనుమతించిన ప్రదేశంలోనే హెల్ప్ డెస్క్ ఏర్పాటు చేయండి.
- స్లిప్‌లో ఓటరు పేరు, పార్ట్ నంబర్, సీరియల్ నంబర్, బూత్ వివరాలు మాత్రమే ఇవ్వండి.
- ఓటరు EPIC లేదా ఇతర అనుమతించిన ఫోటో గుర్తింపు పత్రం తీసుకురావాలని చెప్పండి.
- ఓటర్లకు బూత్ వివరాలు తెలుసుకోవడంలో మాత్రమే సహాయం చేయండి.
- పోలీసులకు, ఎన్నికల సిబ్బందికి సహకరించండి.
చేయకూడనివి:
- ఓటర్లకు ఇచ్చే స్లిప్‌లపై పార్టీ పేరు, గుర్తు, అభ్యర్థి ఫోటోలు లేదా ప్రచార సందేశాలు ఉండకూడదు.
- పోలింగ్ కేంద్రం నిషేధిత పరిధిలో ప్రచారం చేయకూడదు.
- పోలింగ్ కేంద్రంలో మొబైల్ ఫోన్లు ఉపయోగించకూడదు.
- ఓటర్లకు డబ్బు, మద్యం లేదా బహుమతులు ఇవ్వకూడదు.
- గొడవలు, గుంపులు లేదా ఓటర్లకు ఇబ్బంది కలిగించే చర్యలు చేయకూడదు.
- ఓటు ఎవరికి వేయాలో ఓటర్లకు సూచించకూడదు.
సమస్య వస్తే వెంటనే మీ ఇన్‌చార్జ్‌కు తెలియజేయండి.

బూత్ హెల్ప్ డెస్క్ టీమ్$msg$,
  announcement_updated_at = (now() AT TIME ZONE 'UTC'), updated_at = (now() AT TIME ZONE 'UTC');
SELECT assembly_no, e_assemblyname, announcement_enabled, announcement_title, announcement_updated_at FROM assemblies ORDER BY assembly_no;
COMMIT;
