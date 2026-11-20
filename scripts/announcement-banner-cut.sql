-- Switches on the booth-agent alert about cutting the party banner off the
-- slip, for every constituency. Agents see it over the app's home screen and
-- must tick that they have read it.
--
--   bash scripts/prod-sql.sh run scripts/announcement-banner-cut.sql
\set ON_ERROR_STOP on
BEGIN;
UPDATE assemblies SET announcement_enabled = true,
  announcement_title = 'బూత్ ఏజెంట్లకు ముఖ్యమైన సూచన',
  announcement_body = $msg$ప్రింట్ చేసే ఓటరు స్లిప్‌లో పార్టీ బ్యానర్ / ఫోటో ఉన్న భాగాన్ని ఓటర్లు పోలింగ్ కేంద్రానికి తీసుకెళ్లకుండా ముందుగానే తెలియజేయండి.

✅ పార్టీ బ్యానర్ / ఫోటో ఉన్న భాగాన్ని కత్తిరించి వేరు చేయాలని ఓటర్లకు చెప్పండి.

✅ ఓటరు వివరాలు ఉన్న స్లిప్‌ను మాత్రమే తీసుకెళ్లాలని సూచించండి.

✅ ఓటరు గోప్యతను కాపాడండి. ఓటర్ల వ్యక్తిగత వివరాలను అనధికార వ్యక్తులతో పంచుకోవద్దు.

✅ ఓటరు డేటాను బూత్ హెల్ప్ డెస్క్ యాప్‌లో అధికారికంగా కేటాయించిన ప్రయోజనాలకే ఉపయోగించండి.

ధన్యవాదాలు,
**Booth Help Desk టీమ్**$msg$,
  announcement_updated_at = now(), updated_at = now();
SELECT assembly_no, e_assemblyname, announcement_enabled, announcement_title FROM assemblies ORDER BY assembly_no;
COMMIT;
