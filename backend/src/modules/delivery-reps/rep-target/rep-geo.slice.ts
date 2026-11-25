export function isValidCoordinatePair(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Extracts GPS coordinates (lat, lng) from customer metadata or Google Maps location URL.
 */
export function extractCoordinatesFromCustomerLocation(input: {
  locationUrl?: string | null;
  metadata?: Record<string, any> | string | null;
}): { lat: number; lng: number } | null {
  let metaObj: Record<string, any> | null = null;
  if (input.metadata) {
    if (typeof input.metadata === 'string') {
      try {
        metaObj = JSON.parse(input.metadata);
      } catch {
        metaObj = null;
      }
    } else if (typeof input.metadata === 'object') {
      metaObj = input.metadata;
    }
  }

  if (metaObj) {
    const directLat = Number(metaObj.gps_lat ?? metaObj.lat ?? metaObj.latitude);
    const directLng = Number(metaObj.gps_lng ?? metaObj.lng ?? metaObj.longitude);
    if (isValidCoordinatePair(directLat, directLng)) {
      return { lat: directLat, lng: directLng };
    }
  }

  const rawUrl = String(
    input.locationUrl || metaObj?.location_url || metaObj?.locationUrl || metaObj?.google_maps_url || '',
  ).trim();
  if (!rawUrl) return null;

  // Pattern 1: @lat,lng (e.g. https://www.google.com/maps/place/.../@30.0444,31.2357,17z)
  const atMatch = rawUrl.match(/@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (atMatch) {
    const lat = Number(atMatch[1]);
    const lng = Number(atMatch[2]);
    if (isValidCoordinatePair(lat, lng)) return { lat, lng };
  }

  // Pattern 2: ?q=lat,lng or &q=lat,lng or query=lat,lng or ll=lat,lng or destination=lat,lng
  const queryMatch = rawUrl.match(
    /(?:[?&](?:q|query|ll|center|daddr|saddr|destination)=)(-?\d+(?:\.\d+)?)\s*(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
  );
  if (queryMatch) {
    const lat = Number(queryMatch[1]);
    const lng = Number(queryMatch[2]);
    if (isValidCoordinatePair(lat, lng)) return { lat, lng };
  }

  // Pattern 3: !3dLAT!4dLNG in Google Maps embed/place URLs
  const bangMatch = rawUrl.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (bangMatch) {
    const lat = Number(bangMatch[1]);
    const lng = Number(bangMatch[2]);
    if (isValidCoordinatePair(lat, lng)) return { lat, lng };
  }

  // Pattern 4: Direct "lat, lng" string
  const plainMatch = rawUrl.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (plainMatch) {
    const lat = Number(plainMatch[1]);
    const lng = Number(plainMatch[2]);
    if (isValidCoordinatePair(lat, lng)) return { lat, lng };
  }

  return null;
}

/**
 * Calculates great-circle distance in meters between two GPS coordinates using Haversine formula.
 */
export function calculateHaversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export interface GeofenceEvaluationResult {
  status: 'within_geofence' | 'outside_geofence' | 'no_rep_gps' | 'no_customer_gps';
  distanceMeters: number | null;
  isCompliant: boolean | null;
  maxAllowedMeters: number;
}

/**
 * Evaluates whether a field rep's GPS coordinates fall within the customer's geofence radius.
 */
export function evaluateGeofenceCompliance(params: {
  repLat?: number | null;
  repLng?: number | null;
  customerLat?: number | null;
  customerLng?: number | null;
  maxAllowedMeters?: number;
}): GeofenceEvaluationResult {
  const maxAllowedMeters = Math.max(50, Number(params.maxAllowedMeters || 300));
  const repLat = params.repLat !== undefined && params.repLat !== null ? Number(params.repLat) : NaN;
  const repLng = params.repLng !== undefined && params.repLng !== null ? Number(params.repLng) : NaN;
  if (!isValidCoordinatePair(repLat, repLng)) {
    return {
      status: 'no_rep_gps',
      distanceMeters: null,
      isCompliant: null,
      maxAllowedMeters,
    };
  }

  const custLat = params.customerLat !== undefined && params.customerLat !== null ? Number(params.customerLat) : NaN;
  const custLng = params.customerLng !== undefined && params.customerLng !== null ? Number(params.customerLng) : NaN;
  if (!isValidCoordinatePair(custLat, custLng)) {
    return {
      status: 'no_customer_gps',
      distanceMeters: null,
      isCompliant: null,
      maxAllowedMeters,
    };
  }

  const distanceMeters = calculateHaversineDistanceMeters(repLat, repLng, custLat, custLng);
  const isCompliant = distanceMeters <= maxAllowedMeters;
  return {
    status: isCompliant ? 'within_geofence' : 'outside_geofence',
    distanceMeters,
    isCompliant,
    maxAllowedMeters,
  };
}
