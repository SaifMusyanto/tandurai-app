import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

const addFarmOperatorCall = httpsCallable(functions, 'addFarmOperator');
const removeFarmOperatorCall = httpsCallable(functions, 'removeFarmOperator');
const createGatewayCall = httpsCallable(functions, 'createGateway');
const assignSensorCall = httpsCallable(functions, 'assignSensor');
const disableGatewayCall = httpsCallable(functions, 'disableGateway');

export async function addFarmOperator({ farmId, email }) {
  const result = await addFarmOperatorCall({ farmId, email });
  return result.data;
}

export async function removeFarmOperator({ farmId, uid }) {
  const result = await removeFarmOperatorCall({ farmId, uid });
  return result.data;
}

/** Returns a short-lived gateway bootstrap custom token. Never persist or log it. */
export async function createGateway({ farmId, gatewayId, name }) {
  const result = await createGatewayCall({ farmId, gatewayId, name });
  return result.data;
}

export async function assignSensor({ farmId, kumbungId, sensorId, gatewayId, name, hardwareAddress }) {
  const result = await assignSensorCall({
    farmId,
    kumbungId,
    sensorId,
    gatewayId,
    name,
    hardwareAddress,
  });
  return result.data;
}
export async function disableGateway({ farmId, gatewayId }) {
  const result = await disableGatewayCall({ farmId, gatewayId });
  return result.data;
}