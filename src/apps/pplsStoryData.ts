/**
 * The Ppls Story — Liberation History Data Layer
 *
 * Centralized TypeScript dictionary for the multimedia liberation encyclopedia.
 * Isolates historical data from the React rendering cycle.
 */

import { DIASPORA_EVENTS, DIASPORA_DOCUMENTS } from './diasporaData';

// ──────────────────────────────────────────────
// Schema Types
// ──────────────────────────────────────────────

export type Region = 'Africa' | 'Americas' | 'Asia' | 'Oceania' | 'Global';
export type MediaType = 'text' | 'video' | 'audio' | 'image';

export type Era =
  | 'Era 1: Ancestral Dawn'
  | 'Era 2: Medieval & Islamic'
  | 'Era 3: Encounter & Enslavement'
  | 'Era 4: Colonial Conquest & Resistance'
  | 'Era 5: Pan-African Crystallization'
  | 'Era 6: Independence & Liberation Wars'
  | 'Era 7: Post-Independence & Setbacks'
  | 'Era 8: Contemporary';

export type SourceTier =
  | 'Tier 1: Oral & Griot Traditions'
  | 'Tier 2: Primary Documents'
  | 'Tier 3: African Scholars'
  | 'Tier 4: Liberation Press'
  | 'Tier 5: Cultural Texts';

export interface HistoricalPrinciple {
  corePrinciple: string;       // The underlying mechanism of power/liberation
  systemOfRestraint: string;   // How this was historically withheld or weaponized
  culturalExpression: string;  // How art, space, or culture manifested this
  inferencePrompt: string;     // A subtle, open-ended question for the user
}

export interface TimelineEvent {
  id: string; // kebab-case, e.g., 'manden-charter-kurukan-fuga'
  year: number; // Use negative numbers for BCE
  era?: Era; // Optional for legacy, required for v2
  sourceTier?: SourceTier; // Optional for legacy, required for v2
  region: Region;
  title: string;
  summary: string; // 2-3 sentences, dense and clean
  mediaType: MediaType;
  mediaPayload: string; // Placeholder URL or VFS path
  primarySourceText: string; // A rich, multi-paragraph historical excerpt or speech
  primarySourceCitation?: string; // Optional for legacy, required for v2
  tags: string[];
  artist?: string; // If applicable
  location: { lat: number; lng: number; name: string };
  principle: HistoricalPrinciple; // REQUIRED for all nodes
}

export interface LibraryDocument {
  id: string;
  title: string;
  era: Era;
  sourceTier: SourceTier;
  excerpt: string;
  commentary: string;
  citation: string;
  relatedEventId: string;
  fullTextVfsPath: string;
}

export interface CulturalThread {
  id: string; // e.g., 'thread-griot-to-hiphop'
  title: string; // e.g., 'The Griot Tradition: From Oral Historians to Hip Hop'
  description: string; // How this thread connects time and space
  connectedEventIds: string[]; // Array of TimelineEvent IDs that belong to this thread
  visualMotif: string; // e.g., 'A continuous line of soundwaves turning into digital waveforms'
}

export interface HistoricalThread {
  id: string;
  title: string;
  nature: string; // e.g. 'system-of-oppression'
  coreIdea: string;
  mechanismOfHarm: string;
  globalTransmission: string;
  modesOfEndurance: string;
  modesOfOvercoming: string;
  connectedEventIds: string[];
  visualMotif: string;
}

export interface LocalEcho {
  id: string;
  location: { lat: number; lng: number; name: string; region: string };
  year: number;
  title: string;
  microHistory: string; // 2-3 sentences about what happened exactly here
  physicalSpace: string; // What the space was then vs. what it is now
  principle: HistoricalPrinciple; // Ties the local event to the broader human spirit
}

export interface RegionMeta {
  name: string;
  displayName: string;
  color: string;
  accentLight: string;
}

// ──────────────────────────────────────────────
// Region Metadata
// ──────────────────────────────────────────────

export const REGION_META: Record<Region, RegionMeta> = {
  Africa: {
    name: 'Africa',
    displayName: 'Africa & The Diaspora',
    color: '#c44020',
    accentLight: '#f0a880',
  },
  Americas: {
    name: 'Americas',
    displayName: 'The Americas',
    color: '#2060a8',
    accentLight: '#90b8e0',
  },
  Global: {
    name: 'Global',
    displayName: 'Global Movements',
    color: '#20884a',
    accentLight: '#80c8a0',
  },
  Asia: {
    name: 'Asia',
    displayName: 'Asia & West Asia',
    color: '#8a2be2',
    accentLight: '#c397f8',
  },
  Oceania: {
    name: 'Oceania',
    displayName: 'Oceania & Pacific',
    color: '#008080',
    accentLight: '#66c2c2',
  }
};

// ──────────────────────────────────────────────
// Timeline Events (10 Core Anchor Nodes)
// ──────────────────────────────────────────────

const ANCHOR_EVENTS: TimelineEvent[] = [
  {
    id: 'victory-stela-piye',
    year: -747,
    era: 'Era 1: Ancestral Dawn',
    sourceTier: 'Tier 2: Primary Documents',
    region: 'Africa',
    title: 'The Victory Stela of King Piye and Kushite Statecraft',
    summary: 'King Piye of Kush conquered Egypt, establishing the Twenty-fifth Dynasty. The stela details his Nile campaign, showing a highly advanced understanding of political legitimacy, divine right, and psychological restraint.',
    mediaType: 'text',
    mediaPayload: 'C:/Ppls_Story/victory_stela_piye.txt',
    primarySourceCitation: 'Victory Stela of Piye, Jebel Barkal, c. 747–716 BCE',
    tags: ['governance', 'kush', 'kemet', 'diplomacy'],
    location: { lat: 18.55, lng: 31.83, name: 'Jebel Barkal, Kush (Sudan)' },
    principle: {
      corePrinciple: 'Indigenizing Legitimacy and Spiritual Restraint',
      systemOfRestraint: 'Eurocentric histories separated Nubian achievements from Black African agency, framing them as foreign conquerors rather than native restorers.',
      culturalExpression: 'Granite carving combining military triumph with religious devotion, emphasizing Piye\'s love of horses and temple restoration.',
      inferencePrompt: 'Piye ruled by positioning himself as the inheritor of tradition rather than a destroyer. How does modern political leadership align or clash with the deep-rooted values of your community?'
    },
    primarySourceText:
      `THE VICTORY STELA OF KING PIYE (c. 747 BCE)\n` +
      `══════════════════════════════════════════════════════════════\n` +
      `From the granite monument at Jebel Barkal, recording his Nile campaign:\n\n` +
      `"Hark! The King of Kush, Piye, beloved of Amun, goes north to Hermopolis and Memphis. He does not slay, nor does he lay waste to the cities of the Delta.\n\n` +
      `Upon his victory, the people of the valley chanted: 'O mighty ruler, O mighty ruler! Piye, O mighty ruler! You return having conquered Lower Egypt; making bulls into women! Happy is the heart of the mother who bore you... You are eternal, your victory enduring.'\n\n` +
      `His Majesty went to the stables where the horses were kept, and he saw that they had been left to hunger. He declared: 'As I live, and as Amun loves me, it is more grievous to my heart that my horses have starved than any other crime committed by my enemies.'"`
  },
  {
    id: 'manden-charter-kurukan-fuga',
    year: 1236,
    era: 'Era 2: Medieval & Islamic',
    sourceTier: 'Tier 2: Primary Documents',
    region: 'Africa',
    title: 'The Manden Charter of Kurukan Fuga',
    summary: 'Following the Battle of Kirina, Sundiata Keita promulgated the Manden Charter, one of the oldest constitutions in the world. It established human rights, personal responsibilities, and ecological conservation in the Mali Empire.',
    mediaType: 'text',
    mediaPayload: 'C:/Ppls_Story/manden_charter.txt',
    primarySourceCitation: 'The Manden Charter, Kurukan Fuga, 1236 CE',
    tags: ['constitution', 'human-rights', 'democracy', 'liberation'],
    location: { lat: 12.65, lng: -7.95, name: 'Kurukan Fuga, Kangaba, Mali' },
    principle: {
      corePrinciple: 'Structural Communitarian Justice',
      systemOfRestraint: 'European legal theory claims human rights originated with the Magna Carta, ignoring that African societies codified human rights and environmental protection centuries prior.',
      culturalExpression: 'Codified in 44 articles, preserved by the djelis (griots) and institutionalized in sanankunya (joking relationships) to defuse clan conflict.',
      inferencePrompt: 'The Manden Charter legislated ecological conservation (Article 38) and prisoners of war treatment (Article 41) in 1236. What rights are currently missing from your society\'s legal system?'
    },
    primarySourceText:
      `THE MANDEN CHARTER (KOURUKAN FOUGA, 1236 CE)\n` +
      `══════════════════════════════════════════════════════════════\n` +
      `Selected Articles of the Mandinka Constitution:\n\n` +
      `- Article 37: Fakombè is nominated chief of hunters.\n` +
      `- Article 38: Before setting fire to the bush, don't look down at the ground, raise your head in the direction of the top of the trees to see whether they bear fruits or flowers.\n` +
      `- Article 39: Domestic animals should be tied during cultivation and freed after the harvest. The dog, the cat, the duck and the poultry are not bound by the measure.\n` +
      `- Article 40: Everybody must respect kinship, marriage, and the neighborhood.\n` +
      `- Article 41: You can kill the enemy, but not humiliate him.`
  },
  {
    id: 'bois-caiman-ceremony',
    year: 1791,
    era: 'Era 3: Encounter & Enslavement',
    sourceTier: 'Tier 1: Oral & Griot Traditions',
    region: 'Americas',
    title: 'The Bois Caïman Congress and Vodou Mobilization',
    summary: 'The Haitian Revolution was catalyzed by a secret Vodou congress led by Dutty Boukman and Cécile Fatiman. It united diverse African ethnic groups in a common struggle for armed liberation.',
    mediaType: 'text',
    mediaPayload: 'C:/Ppls_Story/bois_caiman_ceremony.txt',
    primarySourceCitation: 'Prayer of Dutty Boukman, Bois Caïman, August 14, 1791',
    tags: ['revolution', 'spirituality', 'vodou', 'resistance'],
    location: { lat: 19.75, lng: -72.20, name: 'Bois Caïman, Saint-Domingue (Haiti)' },
    principle: {
      corePrinciple: 'Ontological Warfare and Spiritual Unity',
      systemOfRestraint: 'Colonial history pathologized Vodou as devil worship to deny its role as a sophisticated political and military unifying system.',
      culturalExpression: 'A ceremony combining political military briefing with spiritual ritual, using Ewe-Fon, Kongo, and Yoruba rhythms and dances.',
      inferencePrompt: 'Boukman exhorted the revolutionaries to reject the "god of the whites" who demands crimes. How does reclamation of indigenous spirituality act as a shield against mental colonization?'
    },
    primarySourceText:
      `THE EXHORTATION OF DUTTY BOUKMAN (BOIS CAÏMAN, AUGUST 14, 1791)\n` +
      `══════════════════════════════════════════════════════════════\n` +
      `From the oral records of the Haitian Revolution:\n\n` +
      `"Our God who has ears to hear. You who are hidden in the clouds; who watch us from where you are. You see all that the white has made us suffer.\n\n` +
      `The white man's god asks him to commit crimes. But the god within us wants to do good. Our god, who is so good, so just, He orders us to revenge our wrongs.\n\n` +
      `He will direct our arms and stand by us. We all should throw away the image of the white men's god who is so pitiless. Listen to the voice for liberty that speaks in all our hearts."`
  },
  {
    id: 'freetown-petitions',
    year: 1793,
    era: 'Era 4: Colonial Conquest & Resistance',
    sourceTier: 'Tier 2: Primary Documents',
    region: 'Africa',
    title: 'The Freetown Petitions and Nova Scotian Settlers',
    summary: 'Black Loyalists who founded Freetown petited against the oppressive and paternalistic administration of the corporate Sierra Leone Company, demanding autonomous governance.',
    mediaType: 'text',
    mediaPayload: 'C:/Ppls_Story/freetown_petitions.txt',
    primarySourceCitation: 'Nova Scotian Settlers Petitions, London, 1793',
    tags: ['petitions', 'governance', 'rebellion', 'settlers'],
    location: { lat: 8.47, lng: -13.23, name: 'Freetown, Sierra Leone' },
    principle: {
      corePrinciple: 'Diasporic Autonomous Governance and Corporate Resistance',
      systemOfRestraint: 'Corporate colonial administrators framed Black settlers as ungrateful dependents, ignoring their legal and democratic claims to land and freedom.',
      culturalExpression: 'Written petitions, community delegation (Cato Perkins and Isaac Anderson), and labor strikes against company taxes.',
      inferencePrompt: 'The Freetown settlers fought for land and self-determination against a charter company. In what ways do corporate entities limit community self-determination in your city today?'
    },
    primarySourceText:
      `PETITION OF THE BLACK LOYALIST SETTLERS OF FREETOWN (1793)\n` +
      `══════════════════════════════════════════════════════════════\n` +
      `Presented in London by Cato Perkins and Isaac Anderson:\n\n` +
      `"We, the Nova Scotian settlers, having escaped slavery and fought for our freedom, find the Sierra Leone Company's taxes and land restrictions to be an insupportable burden.\n\n` +
      `We demand the right to govern ourselves, to hold our own lands free of company quit-rents, and to be treated as free citizens, not corporate servants. The company's promises of land have been withheld, and we are treated with contempt by officers who claim to be our benefactors."`
  },
  {
    id: 'yaa-asantewaa-war',
    year: 1900,
    era: 'Era 4: Colonial Conquest & Resistance',
    sourceTier: 'Tier 2: Primary Documents',
    region: 'Africa',
    title: 'Yaa Asantewaa and the Golden Stool Resistance',
    summary: 'Nana Yaa Asantewaa, Queen Mother of Edweso, organized Asante armed resistance against the British demand for the Golden Stool, securing it from capture.',
    mediaType: 'text',
    mediaPayload: 'C:/Ppls_Story/yaa_asantewaa_speech.txt',
    primarySourceCitation: 'Speech of Nana Yaa Asantewaa, Kumasi, 1900',
    tags: ['resistance', 'war', 'women-leaders', 'asante'],
    location: { lat: 6.70, lng: -1.62, name: 'Kumasi, Gold Coast (Ghana)' },
    principle: {
      corePrinciple: 'Sovereignty Defense and Matriarchal Commander-in-Chief',
      systemOfRestraint: 'Colonial narratives portrayed African conquest as swift and passive, ignoring the advanced military tactics and leadership of women in anti-colonial wars.',
      culturalExpression: 'Construction of massive log stockades (Bekwai/Kokofu roads) to block artillery; mobilization chants and military oaths.',
      inferencePrompt: 'Yaa Asantewaa declared she would lead Asante women to fight if the men refused. How does your community value and support matriarchal leadership in modern organizing?'
    },
    primarySourceText:
      `DECLARATION OF NANA YAA ASANTEWAA (KUMASI, 1900)\n` +
      `══════════════════════════════════════════════════════════════\n` +
      `To the Asante Chiefs gathered in secret assembly:\n\n` +
      `"Now I see that some of you fear to go forward to fight for our king…in the brave days of Osei Tutu, Okomfo Anokye, and Opoku Ware, chiefs would not sit down to see their king to be taken away without firing a shot.\n\n` +
      `Is it true that the bravery of Asante is no more? I cannot believe it. It cannot be!\n\n` +
      `I must say this: if you, the men of Asante will not go forward, then we will. We, the women, will. I shall call upon my fellow women. We will fight! We will fight till the last of us falls in the battlefields. It is more honorable to perish in defense of the Golden Stool than to remain in perpetual slavery."`
  },
  {
    id: 'garvey-unia-declaration',
    year: 1920,
    era: 'Era 5: Pan-African Crystallization',
    sourceTier: 'Tier 2: Primary Documents',
    region: 'Americas',
    title: 'Marcus Garvey and the UNIA Declaration of Rights',
    summary: 'The UNIA Convention produced the "Declaration of Rights of the Negro Peoples of the World," asserting complete global citizenship, economic rights, and symbolic sovereignty.',
    mediaType: 'text',
    mediaPayload: 'C:/Ppls_Story/garvey_unia_declaration.txt',
    primarySourceCitation: 'UNIA Declaration of Rights of the Negro Peoples of the World, New York, August 1920',
    tags: ['pan-africanism', 'rights', 'diaspora', 'nationalism'],
    location: { lat: 40.81, lng: -73.95, name: 'Harlem, New York City, USA' },
    principle: {
      corePrinciple: 'Global Mobilization and Symbolic Sovereignty',
      systemOfRestraint: 'Global white supremacy enforced legal segregation, lower wages, mob lynching, and lowercase writing of racial names to deny Black humanity.',
      culturalExpression: 'Red, Black, and Green flag, the universal anthem "Ethiopia, Thou Land of Our Fathers", and massive parade displays.',
      inferencePrompt: 'Declaration 41 states that limited liberty is but a modified form of slavery. Where do you see "limited liberty" or partial citizenship still operating in your society?'
    },
    primarySourceText:
      `DECLARATION OF THE RIGHTS OF THE NEGRO PEOPLES OF THE WORLD (1920)\n` +
      `══════════════════════════════════════════════════════════════\n` +
      `Adopted at the UNIA Convention in Madison Square Garden:\n\n` +
      `"We believe that all those human rights that are common to the rest of mankind should also be enjoyed by us.\n\n` +
      `Observe the following declarations:\n` +
      `- Declaration 39: We adopt the colors Red, Black, and Green as the solemn symbols of the race.\n` +
      `- Declaration 41: Any limited liberty which deprives one of the complete rights and prerogatives of full citizenship is but a modified form of slavery.\n` +
      `- Declaration 54: We demand that the word 'Negro' be written with a capital 'N'."`
  },
  {
    id: 'anc-freedom-charter',
    year: 1955,
    era: 'Era 5: Pan-African Crystallization',
    sourceTier: 'Tier 2: Primary Documents',
    region: 'Africa',
    title: 'The South African Freedom Charter',
    summary: 'The Congress of the People adopted the Freedom Charter in Kliptown, South Africa. It declared a democratic, non-racial South Africa with shared national wealth and land redistribution.',
    mediaType: 'text',
    mediaPayload: 'C:/Ppls_Story/anc_freedom_charter.txt',
    primarySourceCitation: 'The Freedom Charter, Kliptown, June 26, 1955',
    tags: ['charter', 'democracy', 'south-africa', 'redistribution'],
    location: { lat: -26.27, lng: 27.91, name: 'Kliptown, South Africa' },
    principle: {
      corePrinciple: 'Democratic Consensus and Economic Sharing',
      systemOfRestraint: 'The apartheid regime enforced minority rule, spatial enclosure, and race-based disenfranchisement, labeling democratic movements as communist subversion.',
      culturalExpression: 'Multiracial congress, protest songs, and national consensus petition campaigns.',
      inferencePrompt: 'The Charter declares: "South Africa belongs to all who live in it, black and white." How does a liberation movement reconcile the demand for racial equality with the demand for land redistribution?'
    },
    primarySourceText:
      `THE FREEDOM CHARTER (KLIPTOWN, JUNE 26, 1955)\n` +
      `══════════════════════════════════════════════════════════════\n` +
      `Adopted by the Congress of the People:\n\n` +
      `"We, the People of South Africa, declare for all our country and the world to know:\n\n` +
      `- South Africa belongs to all who live in it, black and white, and no government can justly claim authority unless it is based on the will of the people.\n` +
      `- The People Shall Govern!\n` +
      `- All National Groups Shall Have Equal Rights!\n` +
      `- The People Shall Share in the Country's Wealth!\n` +
      `- The Land Shall Be Shared Among Those Who Work It!\n` +
      `- There Shall Be Work and Security; The Doors of Learning and Culture Shall Be Opened!"`
  },
  {
    id: 'cabral-syracuse-lecture',
    year: 1970,
    era: 'Era 6: Independence & Liberation Wars',
    sourceTier: 'Tier 3: African Scholars',
    region: 'Global',
    title: 'Amílcar Cabral: National Liberation and Culture',
    summary: 'Cabral theorized that national liberation is necessarily an act of culture. It requires the reassertion of authentic cultural identity to resist imperial domination.',
    mediaType: 'text',
    mediaPayload: 'C:/Ppls_Story/cabral_syracuse_lecture.txt',
    primarySourceCitation: 'Amílcar Cabral, Syracuse Lecture, Feb 20, 1970',
    tags: ['theory', 'culture', 'decolonization', 'revolution'],
    location: { lat: 43.05, lng: -76.15, name: 'Syracuse University, Syracuse, New York, USA' },
    principle: {
      corePrinciple: 'Culture as a Weapon of Liberation',
      systemOfRestraint: 'Imperialism attempts to repress the cultural life of the colonized to force assimilation and maintain economic extraction through local proxies.',
      culturalExpression: 'Folk traditions, native languages, and revolutionary theater integrated with political education.',
      inferencePrompt: 'Cabral argued that the colonizer often seeks to replace themselves with a "native oppressor." How can modern movements ensure that structural decolonization goes deeper than representation?'
    },
    primarySourceText:
      `NATIONAL LIBERATION AND CULTURE (AMÍLCAR CABRAL, 1970)\n` +
      `══════════════════════════════════════════════════════════════\n` +
      `From the Syracuse University Memorial Lecture:\n\n` +
      `"National liberation is necessarily an act of culture. History teaches us that it is very easy for the foreigner to impose his rule... But imperial domination can only be maintained through the permanent, organized repression of the cultural life of the colonized people.\n\n` +
      `The reassertion of authentic indigenous cultural identity is the first prerequisite for mobilizing a successful armed revolution, preventing the newly freed state from simply mirroring the colonial apparatus."`
  },
  {
    id: 'sankara-oau-debt-speech',
    year: 1987,
    era: 'Era 7: Post-Independence & Setbacks',
    sourceTier: 'Tier 2: Primary Documents',
    region: 'Africa',
    title: 'Thomas Sankara: A United Front Against the Debt',
    summary: 'Burkinabé President Thomas Sankara deconstructed the sovereign debt crisis as a neocolonial tool of recolonization, proposing a collective refusal to pay and local self-reliance.',
    mediaType: 'text',
    mediaPayload: 'C:/Ppls_Story/sankara_oau_debt_speech.txt',
    primarySourceCitation: 'Thomas Sankara, OAU Speech, July 29, 1987',
    tags: ['debt', 'sovereignty', 'neocolonialism', 'self-reliance'],
    location: { lat: 9.03, lng: 38.74, name: 'Addis Ababa, Ethiopia' },
    principle: {
      corePrinciple: 'Economic Self-Reliance and Debt Refusal',
      systemOfRestraint: 'Neocolonial financial structures and institutions (IMF/World Bank) use debt interest and structural adjustments to control sovereign African budgets.',
      culturalExpression: 'Peasant-grown cotton clothing (Faso Dan Fani) worn by Burkinabé delegates; agro-ecological campaigns and mass vaccinations.',
      inferencePrompt: 'Sankara argued that the debt cannot be paid because "if we pay, we will die; if we don\'t pay, they won\'t die." How does financial debt operate as a tool of modern colonization?'
    },
    primarySourceText:
      `A UNITED FRONT AGAINST THE DEBT (THOMAS SANKARA, 1987)\n` +
      `══════════════════════════════════════════════════════════════\n` +
      `From his speech at the OAU Conference in Addis Ababa:\n\n` +
      `"The debt is a cleverly managed reconquest of Africa. The financial institutions demanding repayment are operated by the exact same powers who colonized us.\n\n` +
      `The rich and the poor don't share the same morals. The Bible and the Koran can't serve in the same way those who exploit the people and those who are exploited. There will have to be two editions of the Bible and two editions of the Koran.\n\n` +
      `Observe our delegation: not a single thread comes from Europe or America. We should undertake to live as Africans. It is the only way to live free and to live in dignity."`
  },
  {
    id: 'rhodes-must-fall',
    year: 2015,
    era: 'Era 8: Contemporary',
    sourceTier: 'Tier 4: Liberation Press',
    region: 'Africa',
    title: '#RhodesMustFall and Curriculum Decolonization',
    summary: 'The UCT student movement launched #RhodesMustFall, targeting the Eurocentric curriculum, systemic racism, and demanding institutional decolonization.',
    mediaType: 'text',
    mediaPayload: 'C:/Ppls_Story/rhodes_must_fall.txt',
    primarySourceCitation: '#RhodesMustFall Mission Statement, March 2015',
    tags: ['student-movement', 'decolonization', 'education', 'space'],
    location: { lat: -33.92, lng: 18.42, name: 'University of Cape Town, South Africa' },
    principle: {
      corePrinciple: 'Micro-Institutional Decolonization and Epistemic Reclamation',
      systemOfRestraint: 'Neoliberal universities maintain Eurocentric curricula and symbols of white supremacy, isolating and marginalizing Black students and histories.',
      culturalExpression: 'Statue toppling, administrative occupation, and student-led seminars invoking Fanon and Biko.',
      inferencePrompt: 'The movement stated that removing the statue was only the first step. What symbols of colonial or oppressive histories still stand in your school or city, and what needs to change?'
    },
    primarySourceText:
      `#RHODESMUSTFALL MISSION STATEMENT (CAPE TOWN, MARCH 2015)\n` +
      `══════════════════════════════════════════════════════════════\n` +
      `Published by the student collective at UCT:\n\n` +
      `"The removal of the statue is merely the first step towards the radical decolonization of this university.\n\n` +
      `We challenge the Eurocentric curriculum, the lack of Black representation among faculty, and the broader economic inequalities of post-apartheid South Africa.\n\n` +
      `Why is our land still in the hands of white people? We demand systemic institutional change. We must decolonize the mind, the curriculum, and the space."`
  }
];

export const TIMELINE_EVENTS: TimelineEvent[] = [
  ...ANCHOR_EVENTS,
  ...DIASPORA_EVENTS
];

// ──────────────────────────────────────────────
// Library Documents (10 Core Source Excerpts)
// ──────────────────────────────────────────────

const ANCHOR_DOCUMENTS: LibraryDocument[] = [
  {
    id: 'doc-victory-stela-piye',
    title: 'The Victory Stela of King Piye',
    era: 'Era 1: Ancestral Dawn',
    sourceTier: 'Tier 2: Primary Documents',
    excerpt: `O mighty ruler, O mighty ruler! Piye, O mighty ruler! You return having conquered Lower Egypt; making bulls into women! Happy is the heart of the mother who bore you... You are eternal, your victory enduring.`,
    commentary: 'The Victory Stela of Piye, found at Jebel Barkal, records Piye\'s conquest of Egypt and his establishment of the 25th Dynasty. It reveals a sophisticated rhetoric of indigenous legitimacy, presenting the Kushite king as a defender of traditional Egyptian values rather than a foreign conqueror.',
    citation: 'Victory Stela of Piye, Jebel Barkal, c. 747–716 BCE',
    relatedEventId: 'victory-stela-piye',
    fullTextVfsPath: 'C:/Ppls_Story/victory_stela_piye.txt'
  },
  {
    id: 'doc-manden-charter',
    title: 'The Manden Charter of Kurukan Fuga',
    era: 'Era 2: Medieval & Islamic',
    sourceTier: 'Tier 2: Primary Documents',
    excerpt: `Selected Articles:\n- Article 38: Before setting fire to the bush, don't look down at the ground, raise your head in the direction of the top of the trees to see whether they bear fruits or flowers.\n- Article 41: You can kill the enemy, but not humiliate him.`,
    commentary: 'Promulgated in 1236 CE by Sundiata Keita, the Manden Charter is one of the oldest constitutions in the world. It establishes fundamental rights, social structures, and ecological regulations, predating the European Enlightenment by centuries.',
    citation: 'The Manden Charter, Kurukan Fuga, 1236 CE',
    relatedEventId: 'manden-charter-kurukan-fuga',
    fullTextVfsPath: 'C:/Ppls_Story/manden_charter.txt'
  },
  {
    id: 'doc-bois-caiman-ceremony',
    title: 'Boukman\'s Prayer at Bois Caïman',
    era: 'Era 3: Encounter & Enslavement',
    sourceTier: 'Tier 1: Oral & Griot Traditions',
    excerpt: `Our God who has ears to hear. You who are hidden in the clouds; who watch us from where you are. You see all that the white has made us suffer. The white man's god asks him to commit crimes. But the god within us wants to do good.`,
    commentary: 'Delivered by Dutty Boukman on August 14, 1791, this prayer served as a theological declaration of independence, urging enslaved Africans to reject the god of the enslavers and listen to the voice of liberty.',
    citation: 'Dutty Boukman, Bois Caïman Prayer, Saint-Domingue, August 14, 1791',
    relatedEventId: 'bois-caiman-ceremony',
    fullTextVfsPath: 'C:/Ppls_Story/bois_caiman_ceremony.txt'
  },
  {
    id: 'doc-freetown-petitions',
    title: 'The Freetown Petitions to the Sierra Leone Company',
    era: 'Era 4: Colonial Conquest & Resistance',
    sourceTier: 'Tier 2: Primary Documents',
    excerpt: `We, the Nova Scotian settlers, having escaped slavery and fought for our freedom, find the Sierra Leone Company's taxes and land restrictions to be an insupportable burden. We demand the right to govern ourselves.`,
    commentary: 'Written by Nova Scotian Black Loyalist settlers in 1793, these petitions protested the paternalistic and oppressive corporate rule of the Sierra Leone Company, demanding land rights and self-governance.',
    citation: 'Freetown Settlers Petitions, London/Freetown, 1793',
    relatedEventId: 'freetown-petitions',
    fullTextVfsPath: 'C:/Ppls_Story/freetown_petitions.txt'
  },
  {
    id: 'doc-yaa-asantewaa-speech',
    title: 'Yaa Asantewaa\'s Address to the Asante Chiefs',
    era: 'Era 4: Colonial Conquest & Resistance',
    sourceTier: 'Tier 2: Primary Documents',
    excerpt: `If you, the men of Asante will not go forward, then we will. We, the women, will. I shall call upon my fellow women. We will fight! We will fight till the last of us falls in the battlefields.`,
    commentary: 'Delivered in 1900 in response to British demands for the Golden Stool, Nana Yaa Asantewaa\'s speech shamed hesitant chiefs and rallied the Asante to armed resistance, highlighting the political authority of women in Asante statecraft.',
    citation: 'Speech of Nana Yaa Asantewaa, Kumasi, 1900',
    relatedEventId: 'yaa-asantewaa-war',
    fullTextVfsPath: 'C:/Ppls_Story/yaa_asantewaa_speech.txt'
  },
  {
    id: 'doc-garvey-unia-declaration',
    title: 'The UNIA Declaration of Rights of the Negro Peoples',
    era: 'Era 5: Pan-African Crystallization',
    sourceTier: 'Tier 2: Primary Documents',
    excerpt: `Declaration 41: Any limited liberty which deprives one of the complete rights and prerogatives of full citizenship is but a modified form of slavery.\nDeclaration 54: We demand that the word 'Negro' be written with a capital 'N'.`,
    commentary: 'Adopted at the 1920 UNIA convention in Harlem, this document served as a global charter for Black self-determination, listing grievances against segregation, demanding civil rights, and adopting Pan-African symbols.',
    citation: 'UNIA Declaration of Rights of the Negro Peoples of the World, New York, August 1920',
    relatedEventId: 'garvey-unia-declaration',
    fullTextVfsPath: 'C:/Ppls_Story/garvey_unia_declaration.txt'
  },
  {
    id: 'doc-anc-freedom-charter',
    title: 'The South African Freedom Charter',
    era: 'Era 5: Pan-African Crystallization',
    sourceTier: 'Tier 2: Primary Documents',
    excerpt: `The People Shall Govern! South Africa belongs to all who live in it, black and white, and no government can justly claim authority unless it is based on the will of the people. The Land Shall Be Shared Among Those Who Work It!`,
    commentary: 'Drafted through democratic consensus in 1955, the Freedom Charter proposed a non-racial South Africa with shared national wealth and land redistribution, guiding the anti-apartheid movement.',
    citation: 'The Freedom Charter, Kliptown, June 26, 1955',
    relatedEventId: 'anc-freedom-charter',
    fullTextVfsPath: 'C:/Ppls_Story/anc_freedom_charter.txt'
  },
  {
    id: 'doc-cabral-syracuse-lecture',
    title: 'National Liberation and Culture',
    era: 'Era 6: Independence & Liberation Wars',
    sourceTier: 'Tier 3: African Scholars',
    excerpt: `National liberation is necessarily an act of culture. Imperial domination can only be maintained through the permanent, organized repression of the cultural life of the colonized people.`,
    commentary: 'Delivered in 1970 at Syracuse University, this lecture outlines Cabral\'s core thesis that national liberation is necessarily an act of culture, requiring the rejection of colonial assimilation and the reclaiming of indigenous identity.',
    citation: 'Amílcar Cabral, Syracuse Lecture, Feb 20, 1970',
    relatedEventId: 'cabral-syracuse-lecture',
    fullTextVfsPath: 'C:/Ppls_Story/cabral_syracuse_lecture.txt'
  },
  {
    id: 'doc-sankara-oau-debt-speech',
    title: 'A United Front Against the Debt',
    era: 'Era 7: Post-Independence & Setbacks',
    sourceTier: 'Tier 2: Primary Documents',
    excerpt: `The debt is a cleverly managed reconquest of Africa. The financial institutions demanding repayment are operated by the exact same powers who colonized us. We should undertake to live as Africans.`,
    commentary: 'Delivered at the 1987 OAU summit, this speech deconstructs the African debt crisis as a neocolonial tool of recolonization, advocating for a collective refusal to pay and local self-reliance.',
    citation: 'Thomas Sankara, OAU Speech, July 29, 1987',
    relatedEventId: 'sankara-oau-debt-speech',
    fullTextVfsPath: 'C:/Ppls_Story/sankara_oau_debt_speech.txt'
  },
  {
    id: 'doc-rhodes-must-fall',
    title: '#RhodesMustFall Mission Statement',
    era: 'Era 8: Contemporary',
    sourceTier: 'Tier 4: Liberation Press',
    excerpt: `The removal of the statue is merely the first step towards the radical decolonization of this university. We challenge the Eurocentric curriculum, the lack of Black representation, and broader inequalities.`,
    commentary: 'Released in March 2015 by University of Cape Town students, this statement outlines the call for radical decolonization of higher education, representation, and curriculum, sparking a global student movement.',
    citation: '#RhodesMustFall Mission Statement, Cape Town, March 2015',
    relatedEventId: 'rhodes-must-fall',
    fullTextVfsPath: 'C:/Ppls_Story/rhodes_must_fall.txt'
  }
];

export const LIBRARY_DOCUMENTS: LibraryDocument[] = [
  ...ANCHOR_DOCUMENTS,
  ...DIASPORA_DOCUMENTS
];

// ──────────────────────────────────────────────
// Thematic Threads (Stubs for future phases)
// ──────────────────────────────────────────────

export const CULTURAL_THREADS: CulturalThread[] = [];
export const HISTORICAL_THREADS: HistoricalThread[] = [];

// ──────────────────────────────────────────────
// Local Echoes (Geography and Micro-Histories)
// ──────────────────────────────────────────────

export const LOCAL_ECHOES: LocalEcho[] = [
  {
    id: 'echo-london-mangrove',
    location: { lat: 51.5173, lng: -0.2037, name: 'London, United Kingdom', region: 'Global' },
    year: 1970,
    title: 'The Mangrove Nine Trial',
    microHistory: 'Following police raids on the Mangrove restaurant—a West Indian community sanctuary—activists protested. The subsequent trial of the Mangrove Nine successfully forced the UK courts to recognize systemic racial bias in police conduct.',
    physicalSpace: 'Then: A Caribbean restaurant serving as a community sanctuary. Now: A high-end commercial Notting Hill residential zone.',
    principle: {
      corePrinciple: 'Legal Defiance and Community Gathering',
      systemOfRestraint: 'UK authorities used drug laws and street harassment to criminalize Black social spaces, attempting to close down gathering spaces for West Indian immigrants.',
      culturalExpression: 'Defending themselves in court, the Nine turned the trial into an indictment of the British police force.',
      inferencePrompt: 'The Mangrove restaurant was targeted because it was a sanctuary for immigrants. What cultural community hubs in your city are currently facing pressure or policing today?'
    }
  },
  {
    id: 'echo-dublin-post-office',
    location: { lat: 53.3498, lng: -6.2603, name: 'Dublin, Ireland', region: 'Global' },
    year: 1916,
    title: 'The Easter Rising at the General Post Office',
    microHistory: 'Irish volunteers seized control of the Dublin General Post Office, declaring an independent Irish Republic. Their armed rebellion was crushed by British artillery, but it ignited the final war for Irish independence.',
    physicalSpace: 'Then: The civic heart of imperial communication. Now: Dublin\'s functioning central Post Office and a national monument.',
    principle: {
      corePrinciple: 'Seizing the Channels of Empire',
      systemOfRestraint: 'British military occupation and land acts stripped Irish citizens of economic and political sovereignty, using martial law to suppress republican organizations.',
      culturalExpression: 'Reading the "Proclamation of the Republic" from the GPO steps transformed a civic building into a stage of liberation.',
      inferencePrompt: 'The rebels seized the Post Office to disrupt the empire\'s communication network. What local structures of power exist in your city today, and how do local movements seek to reform or occupy them?'
    }
  },
  {
    id: 'echo-st-petersburg-soviet',
    location: { lat: 59.9343, lng: 30.3351, name: 'St. Petersburg, Russia', region: 'Global' },
    year: 1905,
    title: 'The St. Petersburg Soviet of Workers\' Deputies',
    microHistory: 'During the 1905 Revolution, factory workers established the first Soviet (Council) to coordinate general strikes and demand democratic rights, creating a prototype for collective labor sovereignty.',
    physicalSpace: 'Then: Dense, industrial manufacturing districts and brick factories. Now: Redeveloped cultural hubs, galleries, and residential streets.',
    principle: {
      corePrinciple: 'Direct Democratic Labor Council',
      systemOfRestraint: 'The Tsarist autocracy outlawed trade unions and assembly, relying on police violence and military crackdowns to suppress collective bargaining.',
      culturalExpression: 'Mass general strikes, factory floor assemblies, and independently published pamphlets voicing workers\' demands.',
      inferencePrompt: 'Striking workers created their own democratic councils when the Tsar refused representation. What direct democratic assemblies or worker-run co-ops can you find in your city today?'
    }
  },
  {
    id: 'echo-dakar-festival',
    location: { lat: 14.7167, lng: -17.4677, name: 'Dakar, Senegal', region: 'Africa' },
    year: 1966,
    title: 'The First World Festival of Negro Arts',
    microHistory: 'Senegal hosted the first global celebration of Black culture and Negritude, bringing together Duke Ellington, Langston Hughes, Aimé Césaire, and thousands of artists to celebrate post-colonial cultural sovereignty.',
    physicalSpace: 'Then: A newly built national theatre and open-air arenas. Now: Capital city cultural institutions and national monuments.',
    principle: {
      corePrinciple: 'Pan-African Cultural Sovereignty',
      systemOfRestraint: 'Colonial powers systematically stripped occupied peoples of their heritage, claiming African culture lacked historical value and sophistication.',
      culturalExpression: 'Worldwide exhibitions of modern Black art, traditional dances, and decolonial poetry readings in the African sun.',
      inferencePrompt: 'Dakar hosted a global festival to affirm that cultural sovereignty precedes political freedom. What local festivals or art showcases celebrate your neighborhood\'s cultural inheritance?'
    }
  },
  {
    id: 'echo-soweto-uprising',
    location: { lat: -26.2485, lng: 27.8540, name: 'Soweto, Johannesburg, South Africa', region: 'Africa' },
    year: 1976,
    title: 'The Soweto Student Uprising',
    microHistory: 'Over 10,000 Black students marched peacefully to protest the forced imposition of Afrikaans in their schools. The police opened fire, killing Hector Pieterson and igniting a global campaign against apartheid.',
    physicalSpace: 'Then: A dusty township street corridor. Now: A prominent memorial site and museum visited by international travelers.',
    principle: {
      corePrinciple: 'Youth-Led Educational Defiance',
      systemOfRestraint: 'The apartheid regime used Bantu Education to keep Black children in perpetual manual labor, restricting native language and pride.',
      culturalExpression: 'Students sang freedom songs and carried handwritten placards while marching in school uniforms.',
      inferencePrompt: 'Students in Soweto put their bodies on the line to protest inferior school conditions. What inequalities exist in your local school system today, and how are youth organizing?'
    }
  },
  {
    id: 'echo-beijing-tiananmen',
    location: { lat: 39.9042, lng: 116.4074, name: 'Beijing, China', region: 'Asia' },
    year: 1919,
    title: 'The May Fourth Movement',
    microHistory: 'Over 3,000 students gathered in Tiananmen Square to protest the Treaty of Versailles, which handed Chinese territory to Japan. This local student protest catalyzed a national wave of intellectual modernization.',
    physicalSpace: 'Then: An open imperial plaza. Now: A heavily guarded, massive concrete national square.',
    principle: {
      corePrinciple: 'Anti-Imperialist Student Mobilization',
      systemOfRestraint: 'Western powers and corrupt local warlords carved up Chinese territory and assets, treating the country as colonial territory.',
      culturalExpression: 'Vernacular literature, print media, and public debates challenged ancient traditions and imperialist treaties.',
      inferencePrompt: 'Students in Beijing protested local land loss to foreign empires. What local environmental or land-use issues in your city are currently being protested by youth?'
    }
  },
  {
    id: 'echo-mumbai-dalit-panthers',
    location: { lat: 19.0760, lng: 72.8777, name: 'Mumbai, India', region: 'Asia' },
    year: 1972,
    title: 'Founding of the Dalit Panthers',
    microHistory: 'Inspired by the US Black Panthers, writers Namdeo Dhasal and J.V. Pawar founded the Dalit Panthers in Siddharth Vihar. They used radical literature and self-defense to combat caste-based violence and untouchability.',
    physicalSpace: 'Then: A crowded tenement residential building for marginalized students. Now: A busy educational campus and local residential blocks.',
    principle: {
      corePrinciple: 'Radical Literary and Self-Defense Coalition',
      systemOfRestraint: 'The ancient caste system segregated Dalits (Untouchables), exposing them to regular systemic violence and denying them access to public water and schools.',
      culturalExpression: 'Radical Marathi street poetry and independent pamphlets challenged elite literary institutions directly.',
      inferencePrompt: 'The Dalit Panthers adapted the tactics of the Black Panthers to fight caste discrimination in India. What international civil rights symbols or strategies have local groups in your city adopted?'
    }
  },
  {
    id: 'echo-detroit-drum',
    location: { lat: 42.3314, lng: -83.0458, name: 'Detroit, Michigan', region: 'Americas' },
    year: 1968,
    title: 'The Dodge Revolutionary Union Movement (DRUM)',
    microHistory: 'Black auto workers at the Hamtramck Assembly plant founded DRUM to protest double exploitation by Chrysler management and the white-led UAW union. They held wildcat strikes and shut down assembly lines.',
    physicalSpace: 'Then: A massive, smoking automotive manufacturing hub. Now: Re-zoned industrial blocks and modern commercial areas.',
    principle: {
      corePrinciple: 'Wildcat Labor Action and Revolutionary Unionism',
      systemOfRestraint: 'Automotive plants relied on Black workers for the most dangerous, lowest-paid jobs, while union hierarchies colluded with management to suppress grievances.',
      culturalExpression: 'Hand-typed newspapers and plant-gate rallies built worker consciousness at the point of production.',
      inferencePrompt: 'Detroit auto workers organized wildcat strikes because their own union ignored them. When mainstream organizations fail, what alternative or independent groups do workers in your city form?'
    }
  }
];

// ──────────────────────────────────────────────
// Chronological Query Helpers
// ──────────────────────────────────────────────

/** Calculate distance between two coordinates in miles using the Haversine formula */
export function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Radius of Earth in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Return events filtered by region, sorted chronologically */
export function getEventsForRegion(region: Region): TimelineEvent[] {
  return TIMELINE_EVENTS
    .filter((e) => e.region === region)
    .sort((a, b) => a.year - b.year);
}

/** Return events within a year range, sorted chronologically */
export function getEventsInRange(startYear: number, endYear: number): TimelineEvent[] {
  return TIMELINE_EVENTS
    .filter((e) => e.year >= startYear && e.year <= endYear)
    .sort((a, b) => a.year - b.year);
}

/** Return events for a region within a year range */
export function getFilteredEvents(
  region: Region | 'All',
  startYear: number,
  endYear: number
): TimelineEvent[] {
  return TIMELINE_EVENTS
    .filter((e) => (region === 'All' || e.region === region) && e.year >= startYear && e.year <= endYear)
    .sort((a, b) => a.year - b.year);
}

/** Get the full year range across all events */
export function getYearRange(): { min: number; max: number } {
  const years = TIMELINE_EVENTS.map((e) => e.year);
  return { min: Math.min(...years), max: Math.max(...years) };
}

/** Return local echoes sorted by proximity to the user's location */
export function getNearbyEchoes(userLat: number, userLng: number, radiusMiles: number = 20): LocalEcho[] {
  return LOCAL_ECHOES.filter((echo) => {
    const distance = calculateHaversineDistance(userLat, userLng, echo.location.lat, echo.location.lng);
    return distance <= radiusMiles;
  }).sort((a, b) => {
    const distA = calculateHaversineDistance(userLat, userLng, a.location.lat, a.location.lng);
    const distB = calculateHaversineDistance(userLat, userLng, b.location.lat, b.location.lng);
    return distA - distB;
  });
}

export default TIMELINE_EVENTS;
