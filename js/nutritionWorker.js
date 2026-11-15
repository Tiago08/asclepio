import { BASICS } from './basics.js?v=30';
import { trainMicroModels } from './intelligence.js?v=30';
self.onmessage = () => {
  try{ self.postMessage({models:trainMicroModels(BASICS)}); }
  catch(error){self.postMessage({error:error.message});}
};
