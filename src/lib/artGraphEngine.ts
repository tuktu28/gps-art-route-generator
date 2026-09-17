import { calculateDistanceMeters, calculateTotalDistanceKm } from './routingEngine';
import { ActivityType } from '../types/route';

interface GraphNode {
  lat: number;
  lng: number;
  edges: number[];
}

function pointToSegmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const kmPerLat = 111000;
  const kmPerLng = 111000 * Math.cos((a[0] * Math.PI) / 180);
  const px = p[1] * kmPerLng, py = p[0] * kmPerLat;
  const ax = a[1] * kmPerLng, ay = a[0] * kmPerLat;
  const bx = b[1] * kmPerLng, by = b[0] * kmPerLat;
  const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}

/**
 * Traces geometric art over real local roads using an A* search that penalizes deviation from the drawn lines.
 */
export async function snapGpsArtToGraph(
  waypoints: [number, number][],
  activity: ActivityType
): Promise<{ coordinates: [number, number][]; distanceKm: number } | null> {
  if (waypoints.length < 2) return null;

  // Calculate bounding box for the entire art piece
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const pt of waypoints) {
    if (pt[0] < minLat) minLat = pt[0];
    if (pt[0] > maxLat) maxLat = pt[0];
    if (pt[1] < minLng) minLng = pt[1];
    if (pt[1] > maxLng) maxLng = pt[1];
  }

  // Expand bounding box slightly
  minLat -= 0.005; maxLat += 0.005;
  minLng -= 0.006; maxLng += 0.006;

  const highwayTypes = activity === 'bike'
    ? 'primary|secondary|tertiary|residential|unclassified|cycleway'
    : 'primary|secondary|tertiary|residential|unclassified|pedestrian|living_street|footway|path|track';

  const query = `[out:json][timeout:15];(way["highway"~"${highwayTypes}"]["highway"!~"motorway|trunk|service|construction"](${minLat},${minLng},${maxLat},${maxLng}););out body;>;out skel qt;`;

  const graphNodes = new Map<number, GraphNode>();

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    });
    if (!res.ok) return null;
    const data = await res.json();

    for (const el of data.elements) {
      if (el.type === 'node') {
        graphNodes.set(el.id, { lat: el.lat, lng: el.lon, edges: [] });
      }
    }

    for (const el of data.elements) {
      if (el.type === 'way' && el.nodes) {
        for (let i = 0; i < el.nodes.length - 1; i++) {
          const n1 = el.nodes[i], n2 = el.nodes[i+1];
          if (graphNodes.has(n1) && graphNodes.has(n2)) {
            graphNodes.get(n1)!.edges.push(n2);
            graphNodes.get(n2)!.edges.push(n1);
          }
        }
      }
    }
  } catch (e) {
    console.error('Overpass graph fetch failed', e);
    return null;
  }

  if (graphNodes.size === 0) return null;

  function getNearestNode(lat: number, lng: number): number | null {
    let bestId = null, bestDist = Infinity;
    for (const [id, n] of graphNodes.entries()) {
      const d = calculateDistanceMeters([lat, lng], [n.lat, n.lng]);
      if (d < bestDist) {
        bestDist = d;
        bestId = id;
      }
    }
    return bestId;
  }

  function findPathAStar(startId: number, endId: number, lineA: [number, number], lineB: [number, number]) {
    const openSet = new Set<number>([startId]);
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>();
    gScore.set(startId, 0);
    const fScore = new Map<number, number>();
    fScore.set(startId, 0);

    let iters = 0;
    while (openSet.size > 0 && iters < 8000) {
      iters++;
      let current = -1, lowestF = Infinity;
      for (const id of openSet) {
        const f = fScore.get(id) ?? Infinity;
        if (f < lowestF) {
          lowestF = f;
          current = id;
        }
      }

      if (current === endId) {
        const path = [current];
        let curr = current;
        while (cameFrom.has(curr)) {
          curr = cameFrom.get(curr)!;
          path.unshift(curr);
        }
        return path;
      }

      openSet.delete(current);
      const uNode = graphNodes.get(current)!;

      for (const neighbor of uNode.edges) {
        const vNode = graphNodes.get(neighbor)!;
        const dist = calculateDistanceMeters([uNode.lat, uNode.lng], [vNode.lat, vNode.lng]);
        
        const midLat = (uNode.lat + vNode.lat) / 2;
        const midLng = (uNode.lng + vNode.lng) / 2;
        const penalty = pointToSegmentDistance([midLat, midLng], lineA, lineB);
        
        const tentativeG = gScore.get(current)! + dist + (penalty * 4.0);

        if (tentativeG < (gScore.get(neighbor) ?? Infinity)) {
          cameFrom.set(neighbor, current);
          gScore.set(neighbor, tentativeG);
          const hDist = calculateDistanceMeters([vNode.lat, vNode.lng], [graphNodes.get(endId)!.lat, graphNodes.get(endId)!.lng]);
          fScore.set(neighbor, tentativeG + hDist + (pointToSegmentDistance([vNode.lat, vNode.lng], lineA, lineB) * 4.0));
          openSet.add(neighbor);
        }
      }
    }
    return null;
  }

  const finalCoords: [number, number][] = [];
  
  for (let i = 0; i < waypoints.length - 1; i++) {
    const A = waypoints[i];
    const B = waypoints[i + 1];
    
    // Ignore extremely short geometric steps
    if (calculateDistanceMeters(A, B) < 5.0 && i !== waypoints.length - 2) continue;

    const startId = getNearestNode(A[0], A[1]);
    const endId = getNearestNode(B[0], B[1]);
    
    if (startId && endId) {
      const pathIds = findPathAStar(startId, endId, A, B);
      if (pathIds) {
        const coords = pathIds.map(id => {
          const n = graphNodes.get(id)!;
          return [n.lat, n.lng] as [number, number];
        });
        
        if (finalCoords.length > 0) {
          finalCoords.push(...coords.slice(1));
        } else {
          finalCoords.push(...coords);
        }
      } else {
        // Disconnected network segment fallback (straight line)
        finalCoords.push(B);
      }
    } else {
      finalCoords.push(B);
    }
  }

  // Deduplicate redundant coordinates
  const clean: [number, number][] = [];
  for (const pt of finalCoords) {
    if (clean.length === 0 || calculateDistanceMeters(clean[clean.length - 1], pt) > 3.0) {
      clean.push(pt);
    }
  }

  return { 
    coordinates: clean, 
    distanceKm: calculateTotalDistanceKm(clean)
  };
}
