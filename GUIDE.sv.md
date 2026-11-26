# Battery to Tibber – kom igång

Appens [källkod](app/) finns här för granskning. Inloggning, lagring och dataflöden
beskrivs i [SECURITY.md](SECURITY.md) på engelska.

Guiden gäller version 0.4.0, som finns i Homey App Store.

Appen lämnar batteriprocent till din manuellt tillagda bil i Tibber. Tibber
behåller laddstyrningen. Testad fysisk installation: Homey Pro, Kia EV9,
Kia-appen 2.7.1 och Zaptec. Andra integrationer behöver verifieras med testare.

1. Lägg till bilen i dess vanliga Homey-app. Alternativt kan du lämna aktuella
   batterivärden via Flow. Kia är inget krav.
2. Lägg till en bil manuellt i Tibber där du själv kan ange batteriprocent.
3. Lägg till **Tibber-uppdatering** under **Battery to Tibber** och öppna appens
   konfiguration. Homey Pro 12.4.5 eller senare krävs; inte Homey Cloud.
4. Välj bilen och rätt batterivärde. Listan kan även innehålla andra
   batterienheter, så bekräfta att det verkligen är bilen du valt.
5. Laddgränsen är valfri. Utan gräns skickas faktisk batteriprocent. Med
   AC-gräns 80 % och batteri 60 % skickas 80 % som planeringsvärde till Tibber.
   Vid laddgräns 100 % skickas faktisk procent.
6. Standardkontrollen kräver inkopplad bil och inkopplad hemmaladdare. GPS
   behövs inte. Observera att bilen på jobbet och en annan bil hemma kan uppfylla
   båda signalerna. Vill du ha extra hemkontroll kan du aktivera position inom
   100 meter, om bilappen tillhandahåller position. Adressvalet bekräftas i guiden.
7. Om signaler saknas kan du välja Flow, eller uttryckligen avstå från
   inkopplingskontroll. Då kan värdet uppdateras även när bilen inte laddar hemma.
8. Logga in i Tibber i appens lösenordsfält. Att spara inloggningen lokalt för
   automatisk återanslutning är frivilligt. Välj rätt manuellt tillagd Tibber-bil.
9. Testa med exakt den procent som redan visas i Tibber. Kontrollera att samma
   värde fortfarande visas och aktivera sedan automatiken.

## Uppdateringar och Flow

Homeys befintliga uppgifter läses varje minut. Det anropar inte bilens API.
Aktiv statusuppdatering via bilappen kan däremot göra det. Välj därför detta
uttryckligen och följ bilappens begränsningar. Standard är av. Valbara intervall
är 30, 60, 120 eller 360 minuter. Den verifierade direkta Kia-frågan kräver
dessutom att bilens rapporterade 12 V-nivå är över larmgränsen.

För andra bilappar: välj uppdatering via Flow och koppla **En uppdatering av
bilens status begärs** till bilappens eget uppdateringskort. Förfrågningar sker
bara med aktiv automatik och tillåtande laddarsignal, eller när du uttryckligen
valt bort inkopplingskontroll. Ett skickat kommando gör inte gamla data färska.

**Ange batterinivå från Flow** behöver ingen laddgräns. Det äldre kortet med
batteri och AC-gräns finns kvar. I Flow som datakälla ansvarar ditt Flow för
aktuella data och eventuella hem-/inkopplingsvillkor.

För laddarsignal via Flow i enhetsläget: rapportera aktuell inkoppling minst var
15:e minut och direkt vid urkoppling. Efter omstart krävs en ny signal. Appen
skriver till Tibber högst var 15:e minut och hoppar över oförändrade värden.

## Färskhet och begränsningar

En gammal tidsstämpel kan betyda att batteriprocenten inte ändrats. Utanför den
verifierade Kia-adaptern behandlar appen ändå detta försiktigt som gammalt;
den kan inte anta att en annan bilapp nyligen kontrollerat bilen. Standardgräns
är 30 minuter, valbart 5–120 minuter. Kontrollera bilappens data eller använd
Flow med verkligt aktuella värden om integrationens tidsstämplar inte räcker.

Även skrivtestet omfattas av 15-minutersintervallet. Nekad inloggning pausar
automatiken, och anropsbegränsningar leder till väntan i stället för upprepade
inloggningsförsök. Utan sparat lösenord behöver en utgången session förnyas
manuellt. Paus stoppar automatiken och sessionsförnyelsen.

## Integritet och hjälp

Full Homey-åtkomst behövs för valda källenheter och frivilliga Kia-statusfrågor.
Platsbehörigheten används för frivillig hemkontroll och adressval. Adresssökning
skickas bara på ditt initiativ till Photon hos Komoot. Sparad inloggning ligger
i intern lagring på Homey; utgivaren får inte lösenord, positioner eller
automatisk telemetri. Logga ut för att radera sparad inloggning.

Kopplingen till Tibber är inofficiell och kan påverkas av ändringar där.
Appen är ett oberoende community-projekt och styr inte laddaren eller bilen.
Använd **Issues** för frågor/fel. Beskriv utrustning och versioner, men publicera
inte lösenord, tokens, exakta adresser eller kompletta oredigerade statusutskrifter.
