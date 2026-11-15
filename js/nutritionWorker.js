import { BASICS } from './basics.js?v=29';
import { trainMicroModels } from './intelligence.js?v=29';
self.onmessage = () => {
  try{ self.postMessage({models:trainMicroModels(BASICS)}); }
  catch(error){self.postMessage({error:error.message});}
};
