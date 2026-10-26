export interface ChestReward {version:1;rewards:{type:"XP"|"SYNAPSE_POINTS";amount:number}[]}
export interface PlayerChest {
 chestId:string;title:string;periodType:string;periodKey:string;progress:{current:number;target:number};periodStartsAt:string|null;periodEndsAt:string|null;claimDeadline:string;status:string;claimable:boolean;rewards:ChestReward|null;
 missions:{missionId:string;title:string;completed:boolean}[];capacityException:{status:string;arrivedAt:string}|null;
}
export interface ChestHistory {entries:PlayerChest[];nextCursor:string|null}
export interface AdminChest {chestId:string;title:string;periodType:string;targetCount:number;active:boolean;revision:string;startsAt:string|null;endsAt:string|null;rewards:ChestReward|null;missions:{missionId:string;title:string;active:boolean;revision:string;category:string;periodType:string}[];configurationDigest:string;approvals:{category:string;eventId:string|null;status:string}[];blockers:string[];activationReady:boolean;activationEffectiveAt:string}
export const chestTotals=(reward:ChestReward|null)=>reward?.rewards.reduce((a,r)=>({xp:a.xp+(r.type==="XP"?r.amount:0),sp:a.sp+(r.type==="SYNAPSE_POINTS"?r.amount:0)}),{xp:0,sp:0})??null;

export interface ChestProductTemplate {selectable:number;required:number;xp:number;synapsePoints:number;reset:string}
export interface ChestProductPolicy {version:string;approvedOn:string;scope:"PRODUCT_TEMPLATE_ONLY";requiresRecordedProductApproval:true;requiresRecordedRewardBudgetApproval:true;manualClaims:true;claimGraceHours:24;timezone:"UTC";periods:{DAILY:ChestProductTemplate;WEEKLY:ChestProductTemplate}}
