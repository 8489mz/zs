import { calculateHaversineDistanceMeters } from './rep-target.engine';

export interface RouteStopInput {
  id: number;
  name: string;
  lat?: number | null;
  lng?: number | null;
  address?: string;
  district?: string;
  customerCode?: string;
  originalSequence?: number;
  [key: string]: any;
}

export interface OptimizedRouteStop extends RouteStopInput {
  sequenceIndex: number;
  legDistanceMeters: number;
  cumulativeDistanceMeters: number;
  isUnmappedGps?: boolean;
}

export interface RouteOptimizationResult {
  stats: {
    totalStops: number;
    mappedStopsCount: number;
    unmappedStopsCount: number;
    originalDistanceMeters: number;
    optimizedDistanceMeters: number;
    savedDistanceMeters: number;
    originalDistanceKm: number;
    optimizedDistanceKm: number;
    savedDistanceKm: number;
    savingsPercent: number;
  };
  orderedStops: OptimizedRouteStop[];
}

function isValidCoord(val: any): boolean {
  if (val === undefined || val === null) return false;
  const n = Number(val);
  return !isNaN(n) && n !== 0 && isFinite(n);
}

/**
 * Pure calculation engine for Dynamic Route Optimization (TSP with Nearest Neighbor & 2-Opt heuristic)
 */
export function optimizeRouteTsp(
  stops: RouteStopInput[],
  options?: {
    startLat?: number | null;
    startLng?: number | null;
  },
): RouteOptimizationResult {
  const mappedStops: (RouteStopInput & { lat: number; lng: number })[] = [];
  const unmappedStops: RouteStopInput[] = [];

  for (const stop of stops) {
    if (isValidCoord(stop.lat) && isValidCoord(stop.lng)) {
      mappedStops.push({
        ...stop,
        lat: Number(stop.lat),
        lng: Number(stop.lng),
      });
    } else {
      unmappedStops.push(stop);
    }
  }

  // Calculate original distance for mapped stops in their given order
  let originalDistanceMeters = 0;
  for (let i = 0; i < mappedStops.length - 1; i++) {
    originalDistanceMeters += calculateHaversineDistanceMeters(
      mappedStops[i].lat,
      mappedStops[i].lng,
      mappedStops[i + 1].lat,
      mappedStops[i + 1].lng,
    );
  }

  if (mappedStops.length <= 1) {
    const ordered: OptimizedRouteStop[] = mappedStops.map((s, idx) => ({
      ...s,
      sequenceIndex: idx + 1,
      legDistanceMeters: 0,
      cumulativeDistanceMeters: 0,
    }));
    for (const u of unmappedStops) {
      ordered.push({
        ...u,
        sequenceIndex: ordered.length + 1,
        legDistanceMeters: 0,
        cumulativeDistanceMeters: 0,
        isUnmappedGps: true,
      });
    }

    return {
      stats: {
        totalStops: stops.length,
        mappedStopsCount: mappedStops.length,
        unmappedStopsCount: unmappedStops.length,
        originalDistanceMeters: Math.round(originalDistanceMeters),
        optimizedDistanceMeters: Math.round(originalDistanceMeters),
        savedDistanceMeters: 0,
        originalDistanceKm: Number((originalDistanceMeters / 1000).toFixed(2)),
        optimizedDistanceKm: Number((originalDistanceMeters / 1000).toFixed(2)),
        savedDistanceKm: 0,
        savingsPercent: 0,
      },
      orderedStops: ordered,
    };
  }

  // 1. Nearest Neighbor Initialization
  const hasCustomStart = isValidCoord(options?.startLat) && isValidCoord(options?.startLng);
  const startLat = hasCustomStart ? Number(options!.startLat) : mappedStops[0].lat;
  const startLng = hasCustomStart ? Number(options!.startLng) : mappedStops[0].lng;

  const unvisited = [...mappedStops];
  const tour: (RouteStopInput & { lat: number; lng: number })[] = [];

  let currentLat = startLat;
  let currentLng = startLng;

  while (unvisited.length > 0) {
    let bestIdx = 0;
    let minDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const dist = calculateHaversineDistanceMeters(currentLat, currentLng, unvisited[i].lat, unvisited[i].lng);
      if (dist < minDistance) {
        minDistance = dist;
        bestIdx = i;
      }
    }

    const nextStop = unvisited.splice(bestIdx, 1)[0];
    tour.push(nextStop);
    currentLat = nextStop.lat;
    currentLng = nextStop.lng;
  }

  // 2. 2-Opt Local Search Heuristic for Tour Smoothing (up to 50 iterations)
  const n = tour.length;
  let improved = true;
  let iterations = 0;
  const maxIterations = 50;

  const getDistance = (i: number, j: number) => {
    return calculateHaversineDistanceMeters(tour[i].lat, tour[i].lng, tour[j].lat, tour[j].lng);
  };

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 0; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        // Calculate change in distance if we reverse tour[i...k]
        const prevA = i > 0 ? i - 1 : null;
        const nextB = k < n - 1 ? k + 1 : null;

        let currentSegmentDist = 0;
        let newSegmentDist = 0;

        if (prevA !== null) {
          currentSegmentDist += getDistance(prevA, i);
          newSegmentDist += getDistance(prevA, k);
        }
        if (nextB !== null) {
          currentSegmentDist += getDistance(k, nextB);
          newSegmentDist += getDistance(i, nextB);
        }

        if (newSegmentDist < currentSegmentDist - 1) {
          // Perform 2-opt swap: reverse segment between i and k
          let left = i;
          let right = k;
          while (left < right) {
            const temp = tour[left];
            tour[left] = tour[right];
            tour[right] = temp;
            left++;
            right--;
          }
          improved = true;
        }
      }
    }
  }

  // 3. Compute Optimized Distances
  let optimizedDistanceMeters = 0;
  const orderedStops: OptimizedRouteStop[] = [];
  let runningCumulative = 0;

  for (let i = 0; i < tour.length; i++) {
    let legDist = 0;
    if (i === 0) {
      if (hasCustomStart) {
        legDist = calculateHaversineDistanceMeters(startLat, startLng, tour[0].lat, tour[0].lng);
      }
    } else {
      legDist = calculateHaversineDistanceMeters(tour[i - 1].lat, tour[i - 1].lng, tour[i].lat, tour[i].lng);
      optimizedDistanceMeters += legDist;
    }

    runningCumulative += legDist;

    orderedStops.push({
      ...tour[i],
      sequenceIndex: i + 1,
      legDistanceMeters: Math.round(legDist),
      cumulativeDistanceMeters: Math.round(runningCumulative),
    });
  }

  // Append unmapped stops at the end
  for (const u of unmappedStops) {
    orderedStops.push({
      ...u,
      sequenceIndex: orderedStops.length + 1,
      legDistanceMeters: 0,
      cumulativeDistanceMeters: Math.round(runningCumulative),
      isUnmappedGps: true,
    });
  }

  const savedMeters = Math.max(0, originalDistanceMeters - optimizedDistanceMeters);
  const savingsPercent =
    originalDistanceMeters > 0 ? Number(((savedMeters / originalDistanceMeters) * 100).toFixed(1)) : 0;

  return {
    stats: {
      totalStops: stops.length,
      mappedStopsCount: mappedStops.length,
      unmappedStopsCount: unmappedStops.length,
      originalDistanceMeters: Math.round(originalDistanceMeters),
      optimizedDistanceMeters: Math.round(optimizedDistanceMeters),
      savedDistanceMeters: Math.round(savedMeters),
      originalDistanceKm: Number((originalDistanceMeters / 1000).toFixed(2)),
      optimizedDistanceKm: Number((optimizedDistanceMeters / 1000).toFixed(2)),
      savedDistanceKm: Number((savedMeters / 1000).toFixed(2)),
      savingsPercent,
    },
    orderedStops,
  };
}
