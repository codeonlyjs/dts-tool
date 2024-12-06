/**
 * Performs a binary search on an array
 * Returns <0 if not found, use -val-1 to convert to positive insert position
 * compare_items should return <0 if a < b, >0 if a > b otherwise 0
 * @param {any[]} sortedArray Any sorted array
 * @param {(a:any,b:any) => number} compare_items A callback to compare two items
 * @param {any} item The item being searched for
 * @returns {number}
 */
export function binarySearch(sortedArray, compare_items, item) 
{
    let left = 0;
    let right = sortedArray.length - 1;

    while (left <= right) 
    {
        let mid = Math.floor((left + right) / 2);
        let foundVal = sortedArray[mid];

        let compare = compare_items(foundVal, item);

        if (compare == 0) 
            return mid;
        else if (compare < 0) 
            left = mid + 1;
        else
            right = mid - 1; 
    }

    // Not found, return where (convert back to insert position with (-retv-1)
    return -1 - left; 
}

