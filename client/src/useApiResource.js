import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/**
 * Charge une ressource de l'API et suit son état.
 *
 * Les sept écrans de liste répétaient le même bloc : un état pour les données,
 * un pour le chargement, un pour l'erreur, un `useEffect` et une fonction de
 * rechargement. Cette duplication laissait passer des oublis — erreurs jamais
 * affichées, ou état mis à jour après démontage du composant.
 *
 * @param {string} url point d'entrée à interroger
 * @param {*} [initial] valeur avant le premier chargement
 * @returns {{data: *, loading: boolean, error: string|null, setError: Function, refresh: Function}}
 */
export function useApiResource(url, initial = null) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let annule = false;

    api.get(url)
      .then((resultat) => {
        if (annule) return;
        setData(resultat);
        setError(null);
      })
      .catch((err) => {
        if (!annule) setError(err.message);
      })
      .finally(() => {
        if (!annule) setLoading(false);
      });

    // Les réponses arrivées après un démontage ou un changement d'URL sont ignorées.
    return () => { annule = true; };
  }, [url, version]);

  /** Relance le chargement de la ressource. */
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return { data, loading, error, setError, refresh };
}
