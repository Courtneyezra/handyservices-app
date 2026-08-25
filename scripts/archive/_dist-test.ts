import 'dotenv/config';
import { geocodeAddress } from '../server/lib/geocoding';

async function main() {
  const cust = await geocodeAddress('DE24 3EJ');
  console.log('Customer DE24 3EJ:', cust);
  const craig = { lat: 52.955073, lng: -1.141027 };
  if (cust) {
    const R = 3958.8;
    const dLat = ((cust.lat - craig.lat) * Math.PI) / 180;
    const dLng = ((cust.lng - craig.lng) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((craig.lat * Math.PI) / 180) * Math.cos((cust.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    console.log(`Distance Craig→DE24 3EJ: ${dist.toFixed(2)} mi`);
    console.log(`Craig's radius: 10 mi → ${dist > 10 ? 'OUT OF RANGE' : 'in range'}`);
  }
}
main().then(() => process.exit(0));
