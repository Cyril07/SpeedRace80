// fetch.js
import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
// URL de l'API pour récupérer les activités du club
const urlRace80 =
  "https://practice-api.speedhive.com/api/v1/locations/5204928/activities?count=160"; // ✅ Modifier si une autre API est utilisée

// En-têtes nécessaires pour l'appel à l'API
const headers = {
  Origin: "https://speedhive.mylaps.com",
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function timeStringToSeconds(str) {
  // Vérifie si le format contient un ":"
  if (str.includes(":")) {
    // Si oui, c'est une durée avec minutes et secondes
    const [minutes, seconds] = str.split(":").map(Number);
    return minutes * 60 + seconds;
  } else {
    // Sinon, on suppose que c'est déjà en secondes
    return parseFloat(str);
  }
}

function lapTimeValidation(averageTimeLapSession, fLapTime, iMinBestLap) {
  // Vérification de la validité du tour
  const bValidTourAverage =
    averageTimeLapSession - fLapTime < 0 ||
    (averageTimeLapSession - fLapTime > 0 &&
      averageTimeLapSession - fLapTime < 1.5);

  if (fLapTime <= iMinBestLap || !bValidTourAverage) {
    return false;
  }
  return true;
}

async function main() {
  let bestLap = null, // Meilleur temps au tour
    bestConsecutiveLapTime = null, // Meilleur temps consécutif sur 3 tours
    timeInFiveMinutes = 0,
    bestTimeFiveMinutes = null, // Meilleur temps sur une fenêtre de 5 minutes
    nbLapsFiveMinutes = null,
    bestLapsFiveMinutes = null,
    startIndexFiveMinutes = 0,
    averageTimeLapSession = null;

  // Lecture des données éxistantes
  let jsonPathDataSpeed = path.join(__dirname, "dataSpeed.json");
  let jsonDataSpeed = JSON.parse(fs.readFileSync(jsonPathDataSpeed, "utf8"));

  let jsonPathIgnorePilotes = path.join(__dirname, "ignorePilotes.json");
  let jsonIgnorePilotes = JSON.parse(
    fs.readFileSync(jsonPathIgnorePilotes, "utf8")
  );

  // Appel à l'API pour récupérer les activités
  const res = await fetch(urlRace80, {
    method: "GET",
    headers: headers,
  });

  if (!res.ok) {
    throw new Error(`Erreur lors de l'appel à l'API : ${res.statusText}`);
  }

  const oCallActivitiesRace80 = await res.json();
  const aRunsRace80 = oCallActivitiesRace80.activities;
  const lastIdActivity = jsonDataSpeed["Info"].LastIdActivity;

  // Parcourir chaque activité
  for (const element of aRunsRace80) {
    // Eviter de reparcourir les activités déjà traitées
    if (lastIdActivity === element.id) {
      break;
    }

    // Rechercher si il ya des pilotes qu'on souhaite ignorer
    const piloteData = jsonIgnorePilotes["Pilotes"].find(
      (data) => data.Pilote === element.chipLabel
    );

    if (piloteData) {
      continue;
    }

    const urlSession = `https://practice-api.speedhive.com/api/v1/training/activities/${element.id}/sessions`;

    // Appel à l'API pour récupérer les sessions d'une activité
    const oSession = await fetch(urlSession, {
      method: "GET",
      headers: headers,
    });

    const sessionData = await oSession.json();
    const aSessions = sessionData.sessions;

    // Parcourir chaque session
    for (const session of aSessions) {
      // Liste des tours dans la session
      const aLaps = session.laps;

      // Moyenne du temps au tour sans truc bizarre
      let iLapAverage = 0,
        timeAverageSession = 0,
        iFastLap = 0,
        iSlowLap = 0;

      for (const lap of aLaps) {
        const fLapTime = timeStringToSeconds(lap.duration); // Temps du tour

        // Vérification de la validité du tour
        if (fLapTime < 25) {
          timeAverageSession += fLapTime; // Ajouter le temps du tour à la moyenne
          iLapAverage++;
        } else {
          iSlowLap++;
        }

        // Compter les tours rapides
        if (fLapTime < 16) {
          iFastLap++;
        }
      }

      if (iSlowLap > iFastLap) {
        continue; // Si plus de tours lents que rapides, on ignore la session
      }

      averageTimeLapSession = timeAverageSession / iLapAverage;

      // const iMinBestLap = session.medianLapDuration < 12 ? 7 : 16; // Temps minimum pour ignorer les tours "triche"
      const iMinBestLap = averageTimeLapSession < 16.5 && iFastLap < 4 ? 7 : 16; // Temps minimum pour ignorer les tours "triche"
      const sCategory =
        averageTimeLapSession < 16.5 && iFastLap < 4 ? "Touring" : "TT"; // Catégorie basée sur la durée médiane du tour

      // Calcul du meilleur temps au tour et des meilleurs temps consécutifs
      for (let i = 0; i < aLaps.length; i++) {
        const fLapTime = timeStringToSeconds(aLaps[i].duration); // Temps du tour

        if (
          lapTimeValidation(averageTimeLapSession, fLapTime, iMinBestLap) ===
          false
        ) {
          continue; // Ignorer les tours "triche"
        }

        // Mettre à jour le meilleur temps au tour
        if (bestLap === null || fLapTime < bestLap) {
          bestLap = fLapTime;
        }

        // Debug
        // if (element.chipLabel === "4533629 [0]" && bestLap < 26) {
        //   console.log("Debuggage");
        // }

        // Meilleur temps / tour en 5 mins
        timeInFiveMinutes = fLapTime;
        nbLapsFiveMinutes = 1;
        startIndexFiveMinutes = i;

        while (timeInFiveMinutes < 300) {
          if (aLaps[startIndexFiveMinutes] === undefined) break;
          let fLapTime = timeStringToSeconds(
            aLaps[startIndexFiveMinutes].duration
          );
          if (
            lapTimeValidation(averageTimeLapSession, fLapTime, iMinBestLap) ===
            false
          ) {
            break; // Ignorer les tours "triche"
          }

          timeInFiveMinutes += fLapTime;
          nbLapsFiveMinutes++;
          startIndexFiveMinutes++;
        }

        // Mettre à jour le meilleur temps au tour en 5 minutes
        if (
          timeInFiveMinutes > 300 &&
          (bestTimeFiveMinutes === null ||
            nbLapsFiveMinutes > bestLapsFiveMinutes ||
            (nbLapsFiveMinutes === bestLapsFiveMinutes &&
              timeInFiveMinutes < bestTimeFiveMinutes))
        ) {
          bestTimeFiveMinutes = timeInFiveMinutes;
          bestLapsFiveMinutes = nbLapsFiveMinutes; // Mettre à jour le nombre de tours
        }

        // Pas de calcul pour les 3 meilleurs tours si on arrive à la fin de la boucle
        if (aLaps[i + 1] === undefined || aLaps[i + 2] === undefined) {
          continue;
        }

        // On valide chaque tour pour les 3 meilleurs tours consécutifs
        if (
          lapTimeValidation(
            averageTimeLapSession,
            timeStringToSeconds(aLaps[i + 1].duration),
            iMinBestLap
          ) === false ||
          lapTimeValidation(
            averageTimeLapSession,
            timeStringToSeconds(aLaps[i + 2].duration),
            iMinBestLap
          ) === false
        ) {
          continue; // Ignorer les tours "triche"
        }

        // Calculer le temps total pour 3 tours consécutifs
        const lap1 = fLapTime;
        const lap2 = timeStringToSeconds(aLaps[i + 1].duration);
        const lap3 = timeStringToSeconds(aLaps[i + 2].duration);

        const totalLapTime = lap1 + lap2 + lap3;
        if (
          bestConsecutiveLapTime === null ||
          (totalLapTime < bestConsecutiveLapTime &&
            totalLapTime > iMinBestLap * 3)
        ) {
          bestConsecutiveLapTime = totalLapTime;
        }
      }

      // Vérification si des tours valides ont été trouvés
      if (aLaps.length === 0) {
        continue;
      }

      // Mis à jour des données avec arrondi
      bestLap = bestLap !== null ? parseFloat(bestLap.toFixed(3)) : null;
      bestConsecutiveLapTime =
        bestConsecutiveLapTime !== null
          ? parseFloat(bestConsecutiveLapTime.toFixed(3))
          : null;
      bestTimeFiveMinutes =
        bestTimeFiveMinutes !== null
          ? parseFloat(bestTimeFiveMinutes.toFixed(3))
          : null;

      if (!bestLap) {
        continue;
      }

      // if (bestLap < 16.2 && sCategory === "TT") {
      //   console.log("trichhhheeee");
      // }

      // Rechercher l'objet correspondant au pilote dans jsonDataSpeed
      const piloteData = jsonDataSpeed[sCategory].find(
        (data) => data.Pilote === element.chipLabel
      );

      // Si le pilote n'existe pas encore dans le fichier, initialisez un nouvel objet
      if (!piloteData) {
        jsonDataSpeed[sCategory].push({
          Pilote: element.chipLabel,
          BestLap: bestLap,
          Best3Lap: bestConsecutiveLapTime,
          BestFiveMinutes: {
            Laps: bestLapsFiveMinutes,
            Time: bestTimeFiveMinutes,
          },
        });
      } else {
        // Mettre à jour les données du pilote
        if (bestLap !== null && piloteData.BestLap > bestLap) {
          piloteData.BestLap = bestLap;
        }
        if (
          bestConsecutiveLapTime !== null &&
          piloteData.Best3Lap > bestConsecutiveLapTime
        ) {
          piloteData.Best3Lap = bestConsecutiveLapTime;
        }
        if (
          (bestLapsFiveMinutes !== null &&
            bestTimeFiveMinutes !== null &&
            bestLapsFiveMinutes > piloteData.BestFiveMinutes.Laps) ||
          (bestLapsFiveMinutes !== null &&
            bestTimeFiveMinutes !== null &&
            bestLapsFiveMinutes >= piloteData.BestFiveMinutes.Laps &&
            bestTimeFiveMinutes < piloteData.BestFiveMinutes.Time)
        ) {
          piloteData.BestFiveMinutes.Laps = bestLapsFiveMinutes;
          piloteData.BestFiveMinutes.Time = bestTimeFiveMinutes;
        }
      }

      // Réinitialiser les variables pour la prochaine activité
      bestLap = null;
      bestConsecutiveLapTime = null;
      timeInFiveMinutes = 0;
      bestTimeFiveMinutes = null;
      nbLapsFiveMinutes = null;
      bestLapsFiveMinutes = null;
      startIndexFiveMinutes = 0;
    }
  }

  // Mis à jour de la dernière activité traitée
  jsonDataSpeed["Info"].LastIdActivity = aRunsRace80[0].id;

  // Mis à jour de la date de dernière mise à jour
  jsonDataSpeed["Info"].DateTimeLastUpdate = new Date().toISOString();

  // Réécriture complète du fichier
  fs.writeFileSync(
    jsonPathDataSpeed,
    JSON.stringify(jsonDataSpeed, null, 2),
    "utf8"
  );
  console.log("Fichier mis à jour");
}

// Gestion des erreurs
main().catch((error) => {
  console.error("Erreur dans le script :", error);
});
