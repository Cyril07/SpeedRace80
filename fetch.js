// fetch.js
import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
// URL de l'API pour récupérer les activités du club
const urlRace80 =
  "https://practice-api.speedhive.com/api/v1/locations/5204928/activities?count=150"; // ✅ Modifier si une autre API est utilisée

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
      averageTimeLapSession - fLapTime < 3);

  if (fLapTime <= iMinBestLap || !bValidTourAverage) {
    return false;
  }
  return true;
}

async function main() {
  const settingsTrack = {
    minBestLapTT: 19, // Temps minimum pour un meilleur tour
    minBestLapTouring: 7, // Temps minimum pour un meilleur tour en mode Touring
  };

  let bestLap = null, // Meilleur temps au tour
    bestLapDate = null, // Date du meilleur temps au tour
    bestConsecutiveLapTime = null, // Meilleur temps consécutif sur 3 tours
    bestConsecutiveLapsDate = null, // Date du meilleur temps consécutif sur 3 tours
    detailsBestConsecutiveLaps = [], // Détails des 3 meilleurs tours consécutifs
    timeInFiveMinutes = 0, // Temps total des tours dans une fenêtre de 5 minutes
    bestTimeFiveMinutes = null, // Meilleur temps sur une fenêtre de 5 minutes
    nbLapsFiveMinutes = null, // Nombre de tours dans la fenêtre de 5 minutes
    bestLapsFiveMinutes = null, // Meilleur nombre de tours dans la fenêtre de 5 minutes
    detailsBestFiveMinutes = [], // Détails des tours dans la fenêtre de 5 minutes
    bestFiveMinutesDate = null, // Date du meilleur temps sur une fenêtre de 5 minutes
    startIndexFiveMinutes = 0, // Index de départ pour la fenêtre de 5 minutes
    averageTimeLapSession = null; // Moyenne du temps au tour dans la session

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
    // 6081951015 - New track
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

      // Si moins de 5 tours, on ignore la session
      if (aLaps.length <= 5) {
        continue;
      }

      // Moyenne du temps au tour sans truc bizarre
      let iLapAverage = 0,
        timeAverageSession = 0,
        iFastLap = 0,
        iSlowLap = 0;

      for (const lap of aLaps) {
        const fLapTime = timeStringToSeconds(lap.duration); // Temps du tour

        // Vérification de la validité du tour
        if (fLapTime < timeStringToSeconds(session.medianLapDuration) + 2) {
          timeAverageSession += fLapTime; // Ajouter le temps du tour à la moyenne
          iLapAverage++;
        } else {
          iSlowLap++;
        }

        // Compter les tours rapides
        if (fLapTime < settingsTrack.minBestLapTT) {
          iFastLap++;
        }
      }

      if (iSlowLap >= iLapAverage) {
        continue; // Si plus de tours lents que rapides, on ignore la session
      }

      averageTimeLapSession = timeAverageSession / iLapAverage;

      // Temps minimum pour ignorer les tours "triche"
      const iMinBestLap =
        averageTimeLapSession < settingsTrack.minBestLapTT &&
        iFastLap > iLapAverage / 4
          ? settingsTrack.minBestLapTouring
          : settingsTrack.minBestLapTT;

      // Catégorie basée sur la durée médiane du tour
      const sCategory =
        averageTimeLapSession < settingsTrack.minBestLapTT &&
        iFastLap > iLapAverage / 4
          ? "Touring"
          : "TT";

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
          bestLapDate = aLaps[i].dateTimeStart;
        }

        // if (bestLap < 16 && element.chipLabel === "Saintyves Souleymane ") {
        //   console.log("toto");
        // }

        // Meilleur temps / tour en 5 mins
        timeInFiveMinutes = 0;
        nbLapsFiveMinutes = 0;
        startIndexFiveMinutes = i;
        let aBestFiveMinutes = [];
        let dateStartBestFiveMinutes = aLaps[i].dateTimeStart;
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
          aBestFiveMinutes.push({ lap: fLapTime });
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
          bestLapsFiveMinutes = nbLapsFiveMinutes;
          detailsBestFiveMinutes = aBestFiveMinutes;
          bestFiveMinutesDate = dateStartBestFiveMinutes;
        }

        // Pas de calcul pour les 3 meilleurs tours si on arrive à la fin de la boucle
        if (aLaps[i + 1] === undefined || aLaps[i + 2] === undefined) {
          continue;
        }

        // Vérification des tours consécutifs
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
          bestConsecutiveLapsDate = aLaps[i].dateTimeStart;
          detailsBestConsecutiveLaps = [
            { lap: lap1 },
            { lap: lap2 },
            { lap: lap3 },
          ];
        }

        // Fin boucle
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

      // Si un des meilleurs temps est null, on ignore l'activité
      if (
        bestLap === null &&
        bestConsecutiveLapTime === null &&
        bestTimeFiveMinutes === null
      ) {
        continue;
      }

      // Rechercher l'objet correspondant au pilote dans jsonDataSpeed
      const piloteData = jsonDataSpeed[sCategory].find(
        (data) => data.Pilote === element.chipLabel
      );

      // Si le pilote n'existe pas encore dans le fichier, initialisez un nouvel objet
      if (!piloteData) {
        jsonDataSpeed[sCategory].push({
          Pilote: element.chipLabel,
          BestLap: {
            Lap: bestLap,
            Date: bestLapDate,
          },
          Best3Laps: {
            Lap: bestConsecutiveLapTime,
            DetailsLaps: detailsBestConsecutiveLaps,
            Date: bestConsecutiveLapsDate,
          },
          BestFiveMinutes: {
            Laps: bestLapsFiveMinutes,
            Time: bestTimeFiveMinutes,
            DetailsLaps: detailsBestFiveMinutes,
            Date: bestFiveMinutesDate,
          },
        });
      } else {
        // Mettre à jour les données du pilote

        if (
          piloteData.BestLap.Lap === null ||
          (bestLap !== null && piloteData.BestLap.Lap > bestLap)
        ) {
          piloteData.BestLap.Lap = bestLap;
          piloteData.BestLap.Date = bestLapDate;
        }

        if (
          piloteData.Best3Laps.Lap === null ||
          (bestConsecutiveLapTime !== null &&
            piloteData.Best3Laps.Lap > bestConsecutiveLapTime)
        ) {
          piloteData.Best3Laps.Lap = bestConsecutiveLapTime;
          piloteData.Best3Laps.DetailsLaps = detailsBestConsecutiveLaps;
          piloteData.Best3Laps.Date = bestConsecutiveLapsDate;
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
          piloteData.BestFiveMinutes.DetailsLaps = detailsBestFiveMinutes;
          piloteData.BestFiveMinutes.Date = bestFiveMinutesDate;
        }
      }

      // Réinitialiser les variables pour la prochaine activité
      bestLap = null;
      bestLapDate = null;

      bestConsecutiveLapTime = null;
      bestConsecutiveLapsDate = null;
      detailsBestConsecutiveLaps = [];

      bestTimeFiveMinutes = null;
      nbLapsFiveMinutes = null;
      bestLapsFiveMinutes = null;

      detailsBestFiveMinutes = [];
      bestFiveMinutesDate = null;
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
