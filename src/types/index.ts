export interface ParkrunResult {
    athleteId: string;
    name: string;
    event: string;
    date: string;
    time: string;
    position: number;
    totalRuns: number;
    eventRuns: number;
    isFirstTimer: boolean;
    isCoursePb: boolean;
    isAllTimePb: boolean;
}

export interface ClubReport {
    clubNumber: number;
    clubName: string;
    date: string;
    memberCount: number;
    eventCount: number;
    volunteerCount: number;
    volunteerEventCount: number;
    results: ParkrunResult[];
}
